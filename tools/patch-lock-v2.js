// 补丁：锁与房间数据分离（锁放文档顶层），saveRoom 改局部更新，避免整房覆盖把锁写丢
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..', 'minigame')
const cloud = path.join(root, 'cloudfunctions', 'gx13', 'index.js')
let c = fs.readFileSync(cloud, 'utf8')

// 1) saveRoom 用 update（保留顶层 lockAt）
const oldSave = `async function saveRoom(room) {
  room.updatedAt = Date.now()
  await db.collection(COL).doc(String(room.id)).set({ data: { data: room, updatedAt: room.updatedAt } })
}`
const newSave = `async function saveRoom(room) {
  room.updatedAt = Date.now()
  const payload = Object.assign({}, room)
  delete payload.lockAt
  // 只更新数据字段，别把顶层的并发锁一起覆盖掉
  try {
    await db.collection(COL).doc(String(room.id)).update({ data: { data: payload, updatedAt: room.updatedAt } })
  } catch (e) {
    await db.collection(COL).doc(String(room.id)).set({ data: { data: payload, updatedAt: room.updatedAt } })
  }
}`
if (!c.includes(oldSave)) throw new Error('saveRoom anchor missing')
c = c.replace(oldSave, newSave)

// 2) acquire / release 操作文档顶层 lockAt
const oldLock = `async function acquireRoomLock(id) {
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
    const prev = d.lockAt || 0`
const newLock = `async function acquireRoomLock(id) {
  if (!id) return 0
  for (let i = 0; i < 12; i++) {
    let doc = null
    try { doc = await db.collection(COL).doc(String(id)).get() } catch (e) { return 0 }
    const wrapper = doc && doc.data ? doc.data : null
    if (!wrapper || !wrapper.data) return 0
    const prev = wrapper.lockAt || 0`
if (!c.includes(oldLock)) throw new Error('lock anchor missing')
c = c.replace(oldLock, newLock)

// 3) withRoomLock 区分"房间不存在"和"房间忙"
const oldWith = `async function withRoomLock(id, fn) {
  const got = await acquireRoomLock(id)
  if (!got) return { t: 'busy', msg: '房间正忙，请稍后重试' }
  try { return await fn() } finally { await releaseRoomLock(id, got) }
}`
const newWith = `async function withRoomLock(id, fn) {
  const got = await acquireRoomLock(id)
  if (!got) {
    const exists = await loadRoom(id)
    if (!exists) return { t: 'err', msg: '房间不存在或已解散' }
    return { t: 'busy', msg: '房间正忙，请稍后重试' }
  }
  try { return await fn() } finally { await releaseRoomLock(id, got) }
}`
if (!c.includes(oldWith)) throw new Error('withLock anchor missing')
c = c.replace(oldWith, newWith)

// 4) 房间对象里不再带 lockAt（避免被写进数据字段）
c = c.replace(`    phase: 'wait',
    round: 0,
    lockAt: 0,`, `    phase: 'wait',
    round: 0,`)

// 5) state 路径：拿不到锁只读
const oldState = `  if (action === 'state') {
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
const newState = `  if (action === 'state') {
    const lock = await acquireRoomLock(event.room)
    try {
      const room = await loadRoom(event.room)
      if (!room) return { t: 'err', msg: '房间不存在或已解散' }
      const seat = seatOf(room, openid)
      if (seat < 0) return { t: 'err', msg: '你不在这个房间' }
      if (lock) {
        tick(room)
        await saveRoom(room)
      }
      return viewFor(room, seat)
    } finally {
      await releaseRoomLock(event.room, lock)
    }
  }`
if (c.includes(oldState)) c = c.replace(oldState, newState)

fs.writeFileSync(cloud, c, 'utf8')
console.log('patched: top-level lock + partial update')
