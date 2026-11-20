// 补丁：房间写锁（防并发覆盖）+ 合规文案
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..', 'minigame')
const cloud = path.join(root, 'cloudfunctions', 'gx13', 'index.js')
let c = fs.readFileSync(cloud, 'utf8')

// ---- 1) 锁工具 + newRoomObj 增加 lockAt ----
if (!c.includes('async function acquireRoomLock(')) {
  c = c.replace(
    '// ---------- 房间生命周期 ----------',
    `// ---------- 房间锁（防并发写覆盖） ----------
const LOCK_TTL = 3000
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))

async function acquireRoomLock(id) {
  if (!id) return 0
  for (let i = 0; i < 12; i++) {
    let doc = null
    try { doc = await db.collection(COL).doc(String(id)).get() } catch (e) { return 0 }
    const d = doc && doc.data ? doc.data.data : null
    if (!d) return 0
    if (typeof d.lockAt !== 'number') {
      d.lockAt = 0
      try { await db.collection(COL).doc(String(id)).set({ data: { data: d, updatedAt: Date.now() } }) } catch (e) {}
      continue
    }
    const prev = d.lockAt || 0
    if (prev && Date.now() - prev < LOCK_TTL) { await sleepMs(40); continue }
    const stamp = Date.now()
    try {
      const res = await db.collection(COL).where({ _id: String(id), lockAt: prev })
        .update({ data: { lockAt: stamp } })
      const n = (res && res.stats && res.stats.updated) || 0
      if (n > 0) return stamp
    } catch (e) {}
    await sleepMs(30)
  }
  return 0
}

async function releaseRoomLock(id, stamp) {
  if (!id || !stamp) return
  try {
    await db.collection(COL).where({ _id: String(id), lockAt: stamp }).update({ data: { lockAt: 0 } })
  } catch (e) {}
}

async function withRoomLock(id, fn) {
  const got = await acquireRoomLock(id)
  if (!got) return { t: 'busy', msg: '房间正忙，请稍后重试' }
  try { return await fn() } finally { await releaseRoomLock(id, got) }
}

// ---------- 房间生命周期 ----------`
  )
}

c = c.replace(
  `    phase: 'wait',
    round: 0,`,
  `    phase: 'wait',
    round: 0,
    lockAt: 0,`
)

// ---- 2) handle 主体包锁 ----
const hStart = `  const room = await loadRoom(event.room)
  if (!room) return { t: 'err', msg: '房间不存在或已解散' }
  const seat = seatOf(room, openid)`
if (!c.includes('withRoomLock(event.room')) {
  c = c.replace(hStart, `  return await withRoomLock(event.room, async () => {
` + hStart)
  c = c.replace(
    `  tick(room)
  await saveRoom(room)
  return viewFor(room, seat)
}

exports.main`,
    `  tick(room)
  await saveRoom(room)
  return viewFor(room, seat)
  })
}

exports.main`
  )
}

// ---- 3) state 路径：拿到锁才推进 tick ----
const oldState = `  if (action === 'state') {
    const room = await loadRoom(event.room)
    if (!room) return { t: 'err', msg: '房间不存在或已解散' }
    const seat = seatOf(room, openid)
    if (seat < 0) return { t: 'err', msg: '你不在这个房间' }
    tick(room)
    await saveRoom(room)
    return viewFor(room, seat)
  }`
const newState = `  if (action === 'state') {
    const lock = await acquireRoomLock(event.room)
    try {
      const room = await loadRoom(event.room)
      if (!room) return { t: 'err', msg: '房间不存在或已解散' }
      const seat = seatOf(room, openid)
      if (seat < 0) return { t: 'err', msg: '你不在这个房间' }
      // 抢到锁才推进（AI 出牌/超时），否则只读，避免覆盖别人刚写入的状态
      if (lock) { tick(room); await saveRoom(room) }
      return viewFor(room, seat)
    } finally {
      await releaseRoomLock(event.room, lock)
    }
  }`
if (c.includes(oldState)) c = c.replace(oldState, newState)

fs.writeFileSync(cloud, c, 'utf8')

// ---- 4) 合规文案 ----
const viewFile = path.join(root, 'js', 'views.js')
let v = fs.readFileSync(viewFile, 'utf8')
v = v.replace(
  `      txt(ctx, '第 1 局不进贡 · 出牌逆时针', W / 2, H - 26, 12, C.dim, 'center');`,
  `      txt(ctx, '第 1 局不进贡 · 出牌逆时针 · 纯积分休闲娱乐，不涉及任何财物', W / 2, H - 26, 12, C.dim, 'center');`
)
v = v.replace(
  `      else txt(ctx, '局数与规则由房主设定，其他人进房后沿用', W / 2, py + 258, 12, C.dim, 'center');`,
  `      else txt(ctx, '局数与规则由房主设定 · 纯积分娱乐，无充值无兑换', W / 2, py + 258, 12, C.dim, 'center');`
)
fs.writeFileSync(viewFile, v, 'utf8')

// ---- 5) project.config.json 描述 ----
const pc = path.join(root, 'project.config.json')
let pj = fs.readFileSync(pc, 'utf8')
if (!pj.includes('"description"')) {
  pj = pj.replace(`"projectname": "guangxi13",`, `"projectname": "guangxi13",\n  "description": "广西十三张 · 纯积分休闲牌类小游戏，不涉及现金或实物奖励，无充值与兑换入口",`)
  fs.writeFileSync(pc, pj, 'utf8')
}

console.log('patched: room lock + compliance copy')
