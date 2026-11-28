// 自测：开局即进贡（testTribute）→ 摊牌抽牌 → 逐张还贡
const path = require('path')
const Module = require('module')

const store = { gx13_rooms: {} }
const fakeDb = {
  collection: (name) => ({
    doc: (id) => ({
      get: async () => ({ data: store[name][id] || null }),
      set: async (obj) => { store[name][id] = JSON.parse(JSON.stringify(obj.data)) },
      update: async (arg) => {
        if (!store[name][id]) return { updated: 0 }
        Object.assign(store[name][id], arg.data)
        return { updated: 1 }
      },
      remove: async () => {}
    }),
    where: (cond) => ({
      update: async (arg) => {
        const id = String(cond._id)
        const rec = store[name][id]
        if (!rec) return { stats: { updated: 0 } }
        if ('lockAt' in cond && rec.lockAt !== cond.lockAt) {
          return { stats: { updated: 0 } }
        }
        Object.assign(rec, arg.data)
        return { stats: { updated: 1 } }
      },
      get: async () => ({ data: [] })
    }),
    add: async (obj) => { const id = 'r' + Date.now(); store[name][id] = JSON.parse(JSON.stringify(obj)); return { id } }
  }),
  createCollection: async (n) => { if (!store[n]) store[n] = {} }
}

const origLoad = Module._load
Module._load = function (req, parent, isMain) {
  if (req === 'wx-server-sdk') {
    return { init: () => {}, database: () => fakeDb, getWXContext: () => ({ OPENID: currentOpenid }), DYNAMIC_CURRENT_ENV: 'x' }
  }
  return origLoad.apply(this, arguments)
}
let currentOpenid = 'openid_A'

const fn = require(path.resolve(__dirname, '..', 'minigame', 'cloudfunctions', 'gx13', 'index.js'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

async function main() {
  const created = await fn.main({
    action: 'create', name: '阿明', rounds: 8,
    cfg: { testTribute: true, tributeTier: 'light', turnSeconds: 20, teamHint: 'none' }
  })
  if (created.t !== 'joined') throw new Error('create failed ' + JSON.stringify(created))
  const room = created.room

  currentOpenid = 'openid_A'
  const st = await fn.main({ action: 'start', room })
  log('开局 round=' + st.round + ' phase=' + st.phase)
  await sleep(2600)

  let v = await fn.main({ action: 'state', room })
  log('发牌后 phase=' + v.phase + ' 进贡=' + (v.tribute ? 'stage=' + v.tribute.stage : '无'))
  if (v.phase !== 'tribute') throw new Error('开局没有进贡，testTribute 未生效')

  log('我是否抽牌方 = ' + v.tribute.myTurnToDraw + ' 可抽家=' + JSON.stringify(v.tribute.canDraw) + ' 每家抽 ' + v.tribute.need)

  // 先在 draw 阶段点一个对手（摊牌）
  let guard = 0
  if (v.tribute && v.tribute.stage === 'draw') {
    const cand = v.tribute.canDraw
    log('可抽的人=' + JSON.stringify(cand) + ' 每家抽 ' + v.tribute.count + ' 张')
    await fn.main({ action: 'drawPick', room, seatRel: cand[0] })
    v = await fn.main({ action: 'state', room })
    log('摊牌后 stage=' + v.tribute.stage + ' rows=' + JSON.stringify(v.tribute.pull && v.tribute.pull.rows))
  }

  while (v.phase === 'tribute' && v.tribute && v.tribute.stage === 'pull' && guard++ < 40) {
    const rows = v.tribute.pull.rows
    log('摊开：' + rows.map((r) => 'rel' + r.rel + '=' + r.n + '张').join(' ') + ' 进度 ' + v.tribute.pull.done + '/' + v.tribute.pull.total)
    const quota = v.tribute.pairQuota
    const row = rows.filter((r) => r.n > 0 && (!quota || (v.tribute.pulledFrom[r.rel] || 0) < quota))[0] ||
      rows.filter((r) => r.n > 0)[0]
    if (!row) break
    if (v.tribute.pull.total === 0) { log('total 为 0，跳过'); break }
    await fn.main({ action: 'pullPick', room, seatRel: row.rel, idx: Math.floor(Math.random() * 10) })
    v = await fn.main({ action: 'state', room })
  }

  log('抽完 stage=' + (v.tribute ? v.tribute.stage : '?') + ' 提示=' + (v.tribute ? v.tribute.log.slice(-1)[0].text : ''))
  if (v.tribute) log('抽牌明细=' + JSON.stringify(v.tribute.draws.map((d) => 'from' + d.from + '->to' + d.to + ' ' + d.card.r + '/' + d.card.s)))

  // 批量还贡：一次提交多张
  if (v.phase === 'tribute' && v.tribute && v.tribute.stage === 'return') {
    const needN = v.tribute.ret ? v.tribute.ret.need : 0
    const lows = v.hand.slice().sort((a, b) => (a.r - b.r) || (a.s - b.s)).slice(0, needN)
    log('批量还贡 ' + lows.length + ' 张（一次提交）')
    log('ret 信息=' + JSON.stringify(v.tribute.ret) + ' 提交=' + JSON.stringify(lows.map((c) => c.r + '/' + c.s)))
    const rr = await fn.main({ action: 'retOne', room, cards: lows.map((c) => ({ r: c.r, s: c.s })) })
    log('提交返回=' + JSON.stringify(rr))
    if (rr.t === 'err') log('报错：' + rr.msg)
    v = await fn.main({ action: 'state', room })
    log('提交后 stage=' + (v.tribute ? v.tribute.stage : '?') + ' 还贡数=' + (v.tribute ? v.tribute.returned.length : 0))
  }
  if (v.tribute) log('还贡明细=' + JSON.stringify(v.tribute.returned.map((d) => 'to' + d.to + ' ' + d.card.r + '/' + d.card.s)))
  log('最终 phase=' + v.phase + ' 我的牌=' + (v.hand ? v.hand.length : '-') + ' 三家牌=' +
    (v.seats ? v.seats.map((s) => s.count).join('/') : '-'))
  const all13 = (v.hand ? v.hand.length : 0) === 13
  log(all13 ? 'OK 手牌回到 13 张' : '注意：手牌不是 13 张')
}

main().catch((e) => { console.error('FAIL', e.stack); process.exit(1) })

