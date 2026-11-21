// 广西十三张 · 联机云函数（微信云开发）
// 一个云函数承担全部房间逻辑：建房/加入/出牌/过牌/结算/进贡，客户端只调 callFunction 与拉状态。
// 关键设计：云函数无常驻进程，因此不用 setTimeout，改为“惰性推进”（每次请求先把该发生的推进掉）。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const GX = require('./engine/index.js')
const db = cloud.database()
const COL = 'gx13_rooms'
const TURN_MS = Number(process.env.GX_TURN_MS) || 20000
const DEAL_MS = Number(process.env.GX_DEAL_MS) || 2400

// ---------- 存储 ----------
var colReady = false
async function ensureCollection() {
  if (colReady) return
  try { await db.createCollection(COL) } catch (e) {}
  colReady = true
}

async function loadRoom(id) {
  if (!id) return null
  try {
    const r = await db.collection(COL).doc(String(id)).get()
    return r && r.data ? r.data.data : null
  } catch (e) {
    return null
  }
}

async function saveRoom(room) {
  room.updatedAt = Date.now()
  const payload = Object.assign({}, room)
  delete payload.lockAt
  // 只更新数据字段，别把顶层的并发锁一起覆盖掉
  const body = { data: { data: payload, updatedAt: room.updatedAt } }
  const res = await db.collection(COL).doc(String(room.id)).update(body).catch(() => null)
  const n = (res && res.stats && res.stats.updated) || (res && res.updated) || 0
  // 文档还不存在时 update 影响 0 行，改用 set 建库
  if (!n) await db.collection(COL).doc(String(room.id)).set(body)
}

// ---------- 工具 ----------
function playerName(room, seat) {
  const s = room.seats[seat]
  return s ? (s.name || (s.ai ? '机器人' + (seat + 1) : '空位')) : '空位'
}
function humanCount(room) { return room.seats.filter((s) => s && !s.ai).length }
function cardName(c) {
  const S = ['♦', '♣', '♥', '♠']
  const R = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
  return S[c.s] + (R[c.r] || c.r)
}
function errText(code) {
  const map = {
    'not-turn': '还没轮到你',
    'already-passed': '本轮已过牌',
    'not-same-count': '张数必须和桌面一样',
    'not-bigger': '压不过桌面这手',
    'first-must-d4': '第一手必须含 ♦4',
    'bad-combo': '不是合法牌型',
    'finished': '你已经出完了'
  }
  return map[code] || '出牌不合法'
}

// ---------- 视图 ----------
function viewFor(room, viewer) {
  const g = room.game
  const rel = (s) => (s - viewer + 4) % 4
  const seats = [0, 1, 2, 3].map((r) => {
    const seat = (viewer + r) % 4
    const p = room.seats[seat]
    const gp = g ? g.players[seat] : null
    return {
      name: playerName(room, seat),
      ai: !!(p && p.ai),
      ready: !!(p && p.ready),
      isYou: r === 0,
      count: gp ? gp.hand.length : 0,
      revealedCards: gp ? (gp.revealedCards || []) : [],
      score: room.scores[seat] || 0,
      online: !!(p && p.openid)
    }
  })
  const view = {
    t: 'state',
    room: room.id,
    phase: room.phase,
    round: room.round,
    rounds: room.rounds,
    cfg: pickCfg(room.cfg),
    seats,
    youSeatRel: 0,
    hand: g ? g.players[viewer].hand.slice() : [],
    trickPlays: g ? (g.trickPlays || []).map((pl) => ({ player: rel(pl.player), cards: pl.cards, combo: pl.combo })) : [],
    turn: g && !g.over ? rel(g.turn) : -1,
    combo: g ? g.combo : null,
    firstPlayPending: g ? !!g.firstPlayPending : false,
    over: g ? !!g.over : false,
    deadline: room.deadline || 0,
    firstTurn: !!room.firstTurn,
    host: room.hostSeat === viewer,
    canStart: room.phase === 'wait' && room.hostSeat === viewer && humanCount(room) >= 1,
    lastEvent: room.lastEvent || ''
  }
  if (room.summary) view.summary = { scores: [0, 1, 2, 3].map((r) => room.scores[(viewer + r) % 4]) }
  if (room.tributeShow) {
    const T = room.tributeShow
    const free = freeTargetsOf(T)
    const myDraw = T.stage === 'draw' && T.turnW === viewer
    view.tribute = {
      stage: T.stage,
      count: T.count,
      pairQuota: T.pairQuota || null,
      pulledFrom: T.pulledFrom || {},
      winnerRanks: T.winnerRanks || [],
      draws: T.draws.map((d) => ({ from: rel(d.from), to: rel(d.to), card: d.card })),
      reveals: T.reveals.map((v) => ({ owner: rel(v.owner), card: v.card })),
      returned: (T.returned || []).map((d) => ({ to: rel(d.to), card: d.card })),
      log: (T.log || []).slice(-6),
      need: (T.stage === 'return' && T.turnW === viewer) ? Math.max(0, (T.retQueue || []).length - (T.retIdx || 0)) : 0,
      myTurnToDraw: myDraw,
      canDraw: (myDraw ? free : []).map((s) => rel(s)),
      turnWRel: T.turnW >= 0 ? rel(T.turnW) : -1,
      picks: (T.picks || []).map((s) => rel(s)),
      drawnFrom: (T.current ? [rel(T.current.target)] : []),
      pull: T.stage === 'pull' ? {
        rows: (T.targets || []).map((s) => ({ rel: rel(s), n: room.game.players[s].hand.length })),
        done: T.pulled || 0,
        total: T.total || 0,
        count: T.count
      } : null,
      ret: T.stage === 'return' && T.retQueue ? {
        need: T.retQueue.length - T.retIdx,
        idx: T.retIdx,
        total: T.retQueue.length,
        curFrom: T.retIdx < T.retQueue.length ? rel(T.retQueue[T.retIdx].from) : -1
      } : null,
      targetRel: (T.stage === 'pull' || T.stage === 'return') ? rel(T.target) : -1,
      winnersRel: (T.winners || []).map((s) => rel(s))
    }
  }
  if (room.lastResult) {
    const R = room.lastResult
    view.lastResult = {
      mode: R.camp.mode,
      loneRel: R.camp.mode === 'lone' ? rel(R.camp.lone) : -1,
      ranks: R.ranks.map((s) => rel(s)),
      scores: R.ranks.map((s) => R.scores[s]),
      winRanks: R.winRanks || [],
      teamA: (R.camp.teamA || []).map((s) => rel(s)),
      teamB: (R.camp.teamB || []).map((s) => rel(s))
    }
  }
  return view
}

// ---------- 房间锁（防并发写覆盖） ----------
const LOCK_TTL = 3000
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))

async function acquireRoomLock(id) {
  if (!id) return 0
  for (let i = 0; i < 12; i++) {
    let doc = null
    try { doc = await db.collection(COL).doc(String(id)).get() } catch (e) { return 0 }
    const wrapper = doc && doc.data ? doc.data : null
    if (!wrapper || !wrapper.data) return 0
    const prev = wrapper.lockAt || 0
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
  if (!got) {
    const exists = await loadRoom(id)
    if (!exists) return { t: 'err', msg: '房间不存在或已解散' }
    return { t: 'busy', msg: '房间正忙，请稍后重试' }
  }
  try { return await fn() } finally { await releaseRoomLock(id, got) }
}

// ---------- 房间生命周期 ----------
const CFG_KEYS = ['tributeEnabled', 'tributeTier', 'turnSeconds', 'teamHint', 'loneAnnounce', 'testTribute']

function pickCfg(cfg) {
  const out = {}
  CFG_KEYS.forEach((k) => { out[k] = cfg[k] })
  return out
}

function sanitizeCfg(input) {
  const out = {}
  if (!input || typeof input !== 'object') return out
  if (typeof input.tributeEnabled === 'boolean') out.tributeEnabled = input.tributeEnabled
  if (['heavy', 'light', 'off'].indexOf(input.tributeTier) >= 0) {
    out.tributeTier = input.tributeTier
    out.tributeEnabled = input.tributeTier !== 'off'
  }
  if ([15, 20, 30].indexOf(input.turnSeconds) >= 0) out.turnSeconds = input.turnSeconds
  if (['none', 'reveal', 'always'].indexOf(input.teamHint) >= 0) out.teamHint = input.teamHint
  if (typeof input.loneAnnounce === 'boolean') out.loneAnnounce = input.loneAnnounce
  if (typeof input.testTribute === 'boolean') out.testTribute = input.testTribute
  return out
}

// 房间配置：引擎默认值 + 白名单字段，测试开关单独补回（不进 rules 默认值）
function buildCfg(cfgIn) {
  const picked = sanitizeCfg(cfgIn)
  const cfg = GX.Rules.resolve(picked)
  if (picked.testTribute) cfg.testTribute = true
  return cfg
}

function newRoomObj(id, rounds, cfgIn) {
  return {
    id,
    hostSeat: 0,
    seats: [null, null, null, null],
    rounds: [8, 12, 16, 24, 32].indexOf(rounds) >= 0 ? rounds : 8,
    cfg: buildCfg(cfgIn),
    phase: 'wait',
    round: 0,
    scores: [0, 0, 0, 0],
    game: null,
    lastResult: null,
    tributeShow: null,
    summary: false,
    deadline: 0,
    lastEvent: ''
  }
}

function startRoom(room) {
  room.seats = room.seats.map((s, i) => (s ? s : { name: '机器人' + (i + 1), ai: true, ready: true }))
  room.round = 0
  room.scores = [0, 0, 0, 0]
  room.lastResult = null
  room.summary = false
  newRound(room)
}

function newRound(room) {
  room.round++
  room.phase = 'deal'
  room.tributeShow = null
  room.lastResult = room.lastResult || null
  room.game = GX.Table.createRound({ seed: Math.floor(Math.random() * 4e9), config: room.cfg })
  room.deadline = Date.now() + DEAL_MS
  room.lastEvent = '发牌'
}

const TRIBUTE_MS = 40000

function freeTargetsOf(T) {
  if (!T || !T.losers) return []
  if (T.losers.length === 1) return T.losers.slice()
  return T.losers.filter((l) => T.picks.indexOf(l) < 0)
}

function candOf(room, a, b) {
  const rv = (r) => GX.Rules.rankVal(r, room.cfg.rankOrder)
  return (rv(a.r) - rv(b.r)) || (a.s - b.s)
}

// 发牌动画时间到了 → 建立进贡流程（人类逐个抽，AI 自动）→ 进入出牌
function afterDeal(room) {
  room.deadline = 0
  // 测试模式：房主开了「开局即进贡」，第 1 局也直接进贡（把房主当上一局第一名）
  if (room.cfg && room.cfg.testTribute && room.game && room.game.camp) {
    // 测试：把房主当作独食胜者，三家同时摊开、抽 3N 张
    room.game.camp = { mode: 'lone', lone: 0, teamA: [], teamB: [] }
    const fake = { ranks: [0, 1, 2, 3], camp: room.game.camp, scores: [0, 0, 0, 0] }
    const p2 = GX.Tribute.plan(fake, room.cfg)
    if (!p2.skip && p2.count > 0) {
      room.lastResult = fake
      startTribute(room, p2)
      return
    }
  }
  if (room.round >= 2 && room.cfg.tributeEnabled && room.lastResult) {
    const plan = GX.Tribute.plan(room.lastResult, room.cfg)
    if (!plan.skip && plan.count > 0) {
      startTribute(room, plan)
      return
    }
  }
  room.phase = 'play'
  scheduleTurn(room)
}

function startTribute(room, plan) {
  const winners = plan.winners.slice()
  const losers = plan.losers.slice()
  // 每个胜方只轮到一次；独食者一轮内把三家一起摊开、抽满 3N 张
  const rounds = winners.slice()
  room.tributeShow = {
    count: plan.count,
    pairQuota: plan.pairQuota || null, // 独食每败方上限（2v2 为 null）
    winners: winners,
    losers: losers,
    winnerRanks: plan.winnerRanks,
    rounds: rounds,
    r: 0,
    turnW: rounds[0],
    stage: 'draw',
    current: null,
    draws: [], returned: [], reveals: [], log: [],
    picks: [], pulledFrom: {}, deadline: 0 // pulledFrom：座位→已被抽走张数（身份牌亮还不计）
  }
  room.phase = 'tribute'
  room.deadline = 0
  room.lastEvent = '进贡'
  pushTributeRound(room)
}

function pushTributeRound(room) {
  const T = room.tributeShow
  if (!T) return
  const w = T.rounds[T.r]
  if (w === undefined) { finishTribute(room); return }
  T.stage = 'draw'
  T.turnW = w
  T.current = null
  const isAI = room.seats[w] && room.seats[w].ai
  T.deadline = isAI ? 0 : Date.now() + TRIBUTE_MS
  if (isAI) {
    autoTribute(room)
    return
  }
}

function advanceTributeRound(room) {
  const T = room.tributeShow
  if (!T) return
  T.r++
  T.current = null
  pushTributeRound(room)
}

function openTributePull(room, target) {
  const T = room.tributeShow
  // 独食：三家败方一起摊开，一轮抽 3N；2v2：只摊选中的那一家
  T.targets = (T.winners.length === 1) ? freeTargetsOf(T) : [target]
  T.target = target
  // 独食 plan.count 已是 quota×3 的总数，须按每败方配额 per 计 total，
  // 否则第 1 名重贡会算出 12×3=36（应为 4×3=12）；2v2 pairQuota=null 时 per=count 不变
  const per = T.pairQuota || T.count
  T.total = per * T.targets.length
  T.pulled = 0
  T.roundStart = T.draws.length
  T.stage = 'pull'
  T.current = null
  T.deadline = Date.now() + TRIBUTE_MS
  T.targets.forEach((s) => { if (T.picks.indexOf(s) < 0) T.picks.push(s) })
}

// 从指定对手手里抽一张（先洗牌再取位置，保证随机）
function pullOne(room, target, idx) {
  const T = room.tributeShow
  const P = room.game.players
  const w = T.turnW
  if (!T.targets || T.targets.indexOf(target) < 0) return
  // 每败方上限只挂独食抽牌方向（winners.length===1）；被抽方向（losers.length===1）
  // 每位胜方配额由 T.total=per×1 与逐家交错轮次保证，pulledFrom 跨轮累计，
  // 此处若误拦会与交错流程死锁（同单机/联机 server 的 perLoserCap 裁决）
  const perLoserCap = !!(T.pairQuota && T.winners && T.winners.length === 1)
  if (perLoserCap && (T.pulledFrom[target] || 0) >= T.pairQuota) return
  const pool = P[target].hand
  if (!pool.length) return
  const order = pool.slice()
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = order[i]; order[i] = order[j]; order[j] = tmp
  }
  const card = order[Math.min(Math.max(0, idx | 0), order.length - 1)]
  const real = pool.findIndex((x) => x.r === card.r && x.s === card.s)
  if (real < 0) return
  if (GX.Tribute.isIdentity(card)) {
    T.reveals.push({ owner: target, card: card })
    P[target].revealed = true
    P[target].revealedCard = card.r
    P[target].revealedCards = (P[target].revealedCards || []).concat([card.r])
    T.log.push({ text: playerName(room, target) + ' 的 ' + cardName(card) + ' 是身份牌，亮出归还后重抽', kind: 'warn' })
    return
  }
  pool.splice(real, 1)
  P[w].hand.push(card)
  T.draws.push({ from: target, to: w, card: card })
  T.log.push({ text: playerName(room, w) + ' 从 ' + playerName(room, target) + ' 抽到 ' + cardName(card), kind: 'draw' })
  T.pulled = (T.pulled || 0) + 1
  T.pulledFrom[target] = (T.pulledFrom[target] || 0) + 1

  if (T.pulled >= T.total) {
    // 抽满 → 还贡：按被抽走的牌从大到小，一张一张还
    T.retQueue = T.draws.slice(T.roundStart || 0).sort((a, b) => -candOf(room, a.card, b.card))
    T.retIdx = 0
    T.current = { w: w, target: target }
    T.stage = 'return'
    T.deadline = Date.now() + TRIBUTE_MS
  }
}

// 还一张：按 retQueue 顺序，还给这一张的原来主人
function retOne(room, cards) {
  const T = room.tributeShow
  if (!T || T.stage !== 'return') return { err: '不在还贡阶段' }
  const cur = T.retQueue[T.retIdx]
  if (!cur) return { err: '还贡已结束' }
  const w = T.turnW
  const hand = room.game.players[w].hand
  let card = null
  if (Array.isArray(cards) && cards.length) {
    const idx = hand.findIndex((x) => x.r === cards[0].r && x.s === cards[0].s)
    if (idx < 0) return { err: '这张牌不在手上' }
    card = hand[idx]
  } else {
    const sorted = hand.slice().filter((c) => !GX.Tribute.isIdentity(c)).sort((a, b) => candOf(room, a, b))
    card = sorted[0] || hand[0]
  }
  if (!card) return { err: '没有可还的牌' }
  const idx2 = hand.findIndex((x) => x.r === card.r && x.s === card.s)
  hand.splice(idx2, 1)
  room.game.players[cur.from].hand.push(card)
  T.returned.push({ from: w, to: cur.from, card: card })
  T.log.push({ text: playerName(room, w) + ' 还 ' + cardName(card) + ' 给 ' + playerName(room, cur.from), kind: 'ret' })
  T.retIdx++
  if (T.retIdx >= T.retQueue.length) {
    T.retDone = true
    T.stage = 'done'
    T.turnW = -1
    T.current = { w: w, target: cur.from }
    T.deadline = Date.now() + 1200
  }
  return {}
}

// 批量还贡：一次提交多张，按 retQueue 顺序逐张还给原主
function retBatch(room, cards) {
  const T = room.tributeShow
  if (!T || T.stage !== 'return') return { err: '不在还贡阶段' }
  const list = Array.isArray(cards) ? cards : []
  if (!list.length) return retOne(room, null)
  let done = 0
  for (let k = 0; k < list.length; k++) {
    if (T.stage !== 'return' || !T.retQueue || T.retIdx >= T.retQueue.length) break
    const r = retOne(room, [list[k]])
    if (r && r.err) return { err: r.err, done: done }
    done++
  }
  return { done: done }
}

function endTributeRound(room) {
  const T = room.tributeShow
  if (!T) return
  T.retDone = false
  T.r++
  T.current = null
  pushTributeRound(room)
}

// AI / 超时：自动摊牌、抽满、逐张还
function autoTribute(room) {
  const T = room.tributeShow
  // 独食被抽方向（pairQuota 非空且 losers.length===1）：每位胜方的完成判据是其自身
  // pulled 达 per（T.total=per×1），目标恒为唯一败方——pulledFrom 跨轮累计，
  // 不得用 freeLosers 空判完成（控制器修订）；该判据只用于独食抽牌方向（winners=1）
  const loneDrawn = !!(T.pairQuota && T.losers && T.losers.length === 1)
  if (T.stage === 'draw') {
    const avail = loneDrawn ? T.losers.slice()
      : GX.Tribute.freeLosers({ losers: freeTargetsOf(T), pairQuota: T.pairQuota }, T.pulledFrom)
    if (!avail.length) { endTributeRound(room); return }
    openTributePull(room, avail[Math.floor(Math.random() * avail.length)])
  }
  let guard = 0
  while (T.stage === 'pull' && guard++ < T.total + 8) {
    const rows0 = T.targets.filter((s) => room.game.players[s].hand.length > 0)
    // 抽牌方向跳过已抽满 pairQuota 的败方；被抽方向不做空判（见上）
    const rows = loneDrawn ? rows0
      : GX.Tribute.freeLosers({ losers: rows0, pairQuota: T.pairQuota }, T.pulledFrom)
    if (!rows.length) break
    pullOne(room, rows[Math.floor(Math.random() * rows.length)], Math.floor(Math.random() * 40))
  }
  guard = 0
  while (T.stage === 'return' && !T.retDone && guard++ < T.total + 8) {
    retOne(room, null)
  }
  if (T.retDone) endTributeRound(room)
}

function finishTribute(room) {
  const T = room.tributeShow
  if (!T) return
  T.stage = 'done'
  T.current = null
  T.turnW = -1
  T.deadline = Date.now() + 1400
  if (T.draws.length && room.game) {
    let best = null
    T.draws.forEach((d) => { if (!best || candOf(room, d.card, best.card) > 0) best = d })
    if (best) {
      room.game.turn = best.from
      room.game.firstPlayPending = false
    }
  }
  room.lastEvent = '进贡完成'
}

function scheduleTurn(room) {
  const g = room.game
  if (!g || g.over || room.phase !== 'play') return
  const seat = g.turn
  const isAI = room.seats[seat] && room.seats[seat].ai
  // 本局第一手（还没人出过牌）给双倍时间，方便看牌
  const baseMs = (room.cfg.turnSeconds || 20) * 1000
  const first = (g.lastPlayer === undefined || g.lastPlayer < 0)
  room.deadline = isAI ? 0 : Date.now() + (first ? Math.max(TURN_MS, baseMs * 2) : TURN_MS)
  room.firstTurn = first
}

function aiAct(room, seat) {
  const g = room.game
  if (!g || g.over || room.phase !== 'play' || g.turn !== seat) return
  const action = GX.AI2.decide(g, seat, 1)
  if (action.type === 'play') {
    GX.Table.play(g, seat, action.cards)
  } else if (GX.Table.pass(g, seat)) {
    const ok = GX.Moves.candidates(g.players[seat].hand, room.cfg)
      .filter((c) => GX.Table.validate(g, seat, c.cards) === null)
    if (ok.length) GX.Table.play(g, seat, GX.Moves.lowest(ok).cards)
  }
  afterAction(room)
}

function humanTimeout(room, seat) {
  const g = room.game
  if (!g || g.over || g.turn !== seat) return
  if (g.combo && GX.Table.pass(g, seat) === null) {
    room.lastEvent = playerName(room, seat) + ' 超时，自动过牌'
  } else {
    const ok = GX.Moves.candidates(g.players[seat].hand, room.cfg)
      .filter((c) => GX.Table.validate(g, seat, c.cards) === null)
    if (ok.length) GX.Table.play(g, seat, GX.Moves.lowest(ok).cards)
    room.lastEvent = playerName(room, seat) + ' 超时，自动出最小牌'
  }
  afterAction(room)
}

function afterAction(room) {
  const g = room.game
  if (g && g.over) { settleRound(room); return }
  scheduleTurn(room)
}

function settleRound(room) {
  const res = GX.Settle.settle(room.game)
  room.lastResult = res
  res.scores.forEach((v, i) => { room.scores[i] += v })
  room.phase = 'settle'
  room.deadline = 0
  room.lastEvent = '本局结束'
}

function nextRound(room) {
  if (room.round >= room.rounds) {
    room.phase = 'summary'
    room.summary = true
    return
  }
  newRound(room)
}

// 惰性推进：把过期该做的事一次做掉（发牌完成、AI 连续行动、人类超时）
function tick(room) {
  let guard = 0
  while (guard++ < 60) {
    if (room.phase === 'deal') {
      if (Date.now() < room.deadline) break
      afterDeal(room)
      continue
    }
    if (room.phase === 'tribute') {
      const T = room.tributeShow
      if (!T) {
        room.phase = 'play'
        room.deadline = 0
        scheduleTurn(room)
        continue
      }
      if (T.stage === 'done') {
        if (Date.now() < T.deadline) break
        room.phase = 'play'
        room.deadline = 0
        scheduleTurn(room)
        continue
      }
      if (T.deadline && Date.now() >= T.deadline) {
        if (T.stage === 'draw' || T.stage === 'pull') {
          autoTribute(room)
        } else if (T.stage === 'return') {
          retOne(room, null)
          if (T.retDone) endTributeRound(room)
        }
        continue
      }
      break
    }
    if (room.phase !== 'play') break
    const g = room.game
    if (!g || g.over) break
    const seat = g.turn
    const isAI = room.seats[seat] && room.seats[seat].ai
    if (isAI) { aiAct(room, seat); continue }
    if (room.deadline && Date.now() >= room.deadline) { humanTimeout(room, seat); continue }
    break
  }
}

// ---------- 入口 ----------
function seatOf(room, openid) {
  return room.seats.findIndex((s) => s && s.openid === openid)
}

async function handle(event, openid, name) {
  const action = event.action || 'state'

  if (action === 'create') {
    let id = ''
    for (let i = 0; i < 30; i++) {
      const cand = String(Math.floor(1000 + Math.random() * 9000))
      const ex = await loadRoom(cand)
      if (!ex) { id = cand; break }
    }
    if (!id) return { t: 'err', msg: '建房失败，稍后再试' }
    const room = newRoomObj(id, event.rounds, event.cfg)
    room.seats[0] = { name: String(name || '玩家').slice(0, 6), openid, ai: false, ready: false }
    room.lastEvent = room.seats[0].name + ' 创建房间'
    tick(room)
    await saveRoom(room)
    const out = viewFor(room, 0)
    out.t = 'state'
    return { t: 'joined', room: id, seat: 0, state: out }
  }

  if (action === 'join') {
    const room = await loadRoom(event.room)
    if (!room) return { t: 'err', msg: '房间不存在' }
    if (room.phase !== 'wait') return { t: 'err', msg: '这局已经开始了' }
    let seat = seatOf(room, openid)
    if (seat < 0) seat = room.seats.findIndex((s) => !s)
    if (seat < 0) return { t: 'err', msg: '房间满了' }
    room.seats[seat] = { name: String(name || '玩家').slice(0, 6), openid, ai: false, ready: false }
    room.lastEvent = room.seats[seat].name + ' 加入房间'
    await saveRoom(room)
    return { t: 'joined', room: room.id, seat, state: viewFor(room, seat) }
  }

  return await withRoomLock(event.room, async () => {
  const room = await loadRoom(event.room)
  if (!room) return { t: 'err', msg: '房间不存在或已解散' }
  const seat = seatOf(room, openid)
  if (seat < 0) return { t: 'err', msg: '你不在这个房间' }

  tick(room)

  if (action === 'ready') {
    if (room.phase === 'wait' && room.seats[seat]) room.seats[seat].ready = event.v !== false
  } else if (action === 'start') {
    if (room.hostSeat !== seat) { await saveRoom(room); return { t: 'err', msg: '只有房主能开始', state: viewFor(room, seat) } }
    if (room.phase === 'wait') startRoom(room)
  } else if (action === 'play') {
    if (room.phase === 'play') {
      const g = room.game
      if (!g || g.over || g.turn !== seat) {
        await saveRoom(room)
        return { t: 'err', msg: '还没轮到你', state: viewFor(room, seat) }
      }
      const cards = (event.cards || []).map((c) => ({ r: c.r, s: c.s }))
      if (cards.length) {
        const err = GX.Table.validate(g, seat, cards)
        if (err) {
          await saveRoom(room)
          return { t: 'err', msg: errText(err), state: viewFor(room, seat) }
        }
        GX.Table.play(g, seat, cards)
        room.lastEvent = playerName(room, seat) + ' 出牌'
        afterAction(room)
        tick(room)
      }
    }
  } else if (action === 'pass') {
    if (room.phase === 'play') {
      const g = room.game
      if (g && !g.over && g.turn === seat) {
        const err = GX.Table.pass(g, seat)
        if (err) {
          await saveRoom(room)
          return { t: 'err', msg: errText(err), state: viewFor(room, seat) }
        }
        room.lastEvent = playerName(room, seat) + ' 过牌'
        afterAction(room)
        tick(room)
      }
    }
  } else if (action === 'drawPick') {
    if (room.phase === 'tribute') {
      const T = room.tributeShow
      if (T && T.stage === 'draw' && T.turnW === seat) {
        const target = (seat + (event.seatRel || 0) + 4) % 4
        if (freeTargetsOf(T).indexOf(target) >= 0) {
          openTributePull(room, target)
          room.lastEvent = playerName(room, seat) + ' 摊开 ' + playerName(room, target) + ' 的牌'
        }
      }
    }
  } else if (action === 'pullPick') {
    if (room.phase === 'tribute') {
      const T = room.tributeShow
      if (T && T.stage === 'pull' && T.turnW === seat) {
        const target = (seat + (event.seatRel || 0) + 4) % 4
        pullOne(room, target, event.idx || 0)
        if (room.tributeShow && room.tributeShow.retDone) endTributeRound(room)
        room.lastEvent = playerName(room, seat) + ' 抽走一张'
      }
    }
  } else if (action === 'retOne') {
    if (room.phase === 'tribute') {
      const T = room.tributeShow
      if (T && T.stage === 'return' && T.turnW === seat) {
        const r = retBatch(room, event.cards || [])
        if (r && r.err && !r.done) {
          await saveRoom(room)
          return { t: 'err', msg: r.err, state: viewFor(room, seat) }
        }
        if (T.retDone) endTributeRound(room)
        room.lastEvent = playerName(room, seat) + ' 还贡'
      }
    }
  } else if (action === 'return') {
    if (room.phase === 'tribute') {
      const T = room.tributeShow
      if (T && T.stage === 'return' && T.turnW === seat) {
        const r = retBatch(room, event.cards || [])
        if (r && r.err && !r.done) {
          await saveRoom(room)
          return { t: 'err', msg: r.err, state: viewFor(room, seat) }
        }
        if (T.retDone) endTributeRound(room)
        room.lastEvent = playerName(room, seat) + ' 还贡'
      }
    }
  } else if (action === 'next') {
    if (room.phase === 'settle' && room.hostSeat === seat) {
      nextRound(room)
      tick(room)
    }
  } else if (action === 'leave') {
    room.seats[seat] = null
    room.lastEvent = '有人离开房间'
    if (room.phase === 'wait' && humanCount(room) === 0) {
      try { await db.collection(COL).doc(String(room.id)).remove() } catch (e) {}
      return { t: 'left' }
    }
  }

  tick(room)
  await saveRoom(room)
  return viewFor(room, seat)
  })
}

exports.main = async (event) => {
  await ensureCollection()
  const ctx = cloud.getWXContext()
  const openid = ctx.OPENID || ''
  const action = (event && event.action) || 'state'
  if (action === 'ping') return { t: 'pong', time: Date.now(), env: process.env.TCB_ENV || '' }

  if (action === 'state') {
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
  }

  return handle(event, openid, event && event.name)
}
