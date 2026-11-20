// 补丁：进贡改为交互式抽牌（人类逐个选人抽，AI 自动；同一对手不可被重复抽）
const fs = require('fs')
const path = require('path')

const file = path.resolve(__dirname, '..', 'minigame', 'cloudfunctions', 'gx13', 'index.js')
let src = fs.readFileSync(file, 'utf8')

// ---------- 1) view 的 tribute 输出 ----------
const VIEW_START = '  if (room.tributeShow) {'
const VIEW_END = '  if (room.lastResult) {'
const v0 = src.indexOf(VIEW_START)
const v1 = src.indexOf(VIEW_END, v0)
if (v0 < 0 || v1 < 0) throw new Error('view anchor not found')

const newView = `  if (room.tributeShow) {
    const T = room.tributeShow
    const free = freeTargetsOf(T)
    const myDraw = T.stage === 'draw' && T.turnW === viewer
    view.tribute = {
      stage: T.stage,
      count: T.count,
      winnerRanks: T.winnerRanks || [],
      draws: T.draws.map((d) => ({ from: rel(d.from), to: rel(d.to), card: d.card })),
      reveals: T.reveals.map((v) => ({ owner: rel(v.owner), card: v.card })),
      returned: (T.returned || []).map((d) => ({ to: rel(d.to), card: d.card })),
      log: (T.log || []).slice(-6),
      need: (T.stage === 'return' && T.turnW === viewer) ? T.count : 0,
      myTurnToDraw: myDraw,
      canDraw: (myDraw ? free : []).map((s) => rel(s)),
      turnWRel: T.turnW >= 0 ? rel(T.turnW) : -1,
      picks: (T.picks || []).map((s) => rel(s)),
      drawnFrom: (T.current ? [rel(T.current.target)] : []),
      winnersRel: (T.winners || []).map((s) => rel(s))
    }
  }
`
src = src.slice(0, v0) + newView + src.slice(v1)

// ---------- 2) afterDeal → 建立进贡流程 ----------
const A0 = src.indexOf('// 发牌动画时间到了')
const A1 = src.indexOf('function scheduleTurn(room) {', A0)
if (A0 < 0 || A1 < 0) throw new Error('afterDeal anchor not found')

const tributeBlock = `const TRIBUTE_MS = 40000

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
  const rounds = []
  if (winners.length === 1) {
    // 独食胜：他一个人依次抽所有对手
    losers.forEach(() => rounds.push(winners[0]))
  } else {
    winners.forEach((w) => rounds.push(w))
  }
  room.tributeShow = {
    count: plan.count,
    winners: winners,
    losers: losers,
    winnerRanks: plan.winnerRanks,
    rounds: rounds,
    r: 0,
    turnW: rounds[0],
    stage: 'draw',
    current: null,
    draws: [], returned: [], reveals: [], log: [],
    picks: [], deadline: 0
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
    const avail = freeTargetsOf(T)
    if (avail.length) {
      doTributeDraw(room, w, avail[Math.floor(Math.random() * avail.length)])
      doTributeReturn(room, null)
    }
    T.r++
    pushTributeRound(room)
  }
}

function advanceTributeRound(room) {
  const T = room.tributeShow
  if (!T) return
  T.r++
  T.current = null
  pushTributeRound(room)
}

function doTributeDraw(room, w, target) {
  const T = room.tributeShow
  const P = room.game.players
  for (let k = 0; k < T.count; k++) {
    let guard = 0, picked = null
    while (guard++ < 30) {
      const pool = P[target].hand
      if (!pool.length) break
      const idx = Math.floor(Math.random() * pool.length)
      const card = pool[idx]
      if (GX.Tribute.isIdentity(card)) {
        T.reveals.push({ owner: target, card: card })
        P[target].revealed = true
        P[target].revealedCard = card.r
        P[target].revealedCards = (P[target].revealedCards || []).concat([card.r])
        T.log.push({ text: playerName(room, target) + ' 的 ' + cardName(card) + ' 是身份牌，亮出归还后重抽', kind: 'warn' })
        continue
      }
      pool.splice(idx, 1)
      P[w].hand.push(card)
      picked = card
      break
    }
    if (picked) {
      T.draws.push({ from: target, to: w, card: picked })
      T.log.push({ text: playerName(room, w) + ' 从 ' + playerName(room, target) + ' 抽到 ' + cardName(picked), kind: 'draw' })
    }
  }
  if (T.picks.indexOf(target) < 0) T.picks.push(target)
  T.current = { w: w, target: target }
  T.stage = 'return'
  const isAI = room.seats[w] && room.seats[w].ai
  T.deadline = isAI ? 0 : Date.now() + TRIBUTE_MS
}

function doTributeReturn(room, cards) {
  const T = room.tributeShow
  const cur = T && T.current
  if (!cur) return { err: '还没抽牌' }
  const hand = room.game.players[cur.w].hand
  let list = []
  if (Array.isArray(cards) && cards.length) {
    if (cards.length !== T.count) return { err: '要还 ' + T.count + ' 张' }
    for (const c of cards) {
      if (hand.some((x) => x.r === c.r && x.s === c.s)) list.push({ r: c.r, s: c.s })
    }
    if (list.length !== T.count) return { err: '还贡的牌不在手上' }
  } else {
    list = hand.slice()
      .filter((c) => !GX.Tribute.isIdentity(c))
      .sort((a, b) => candOf(room, a, b))
      .slice(0, T.count)
      .map((c) => ({ r: c.r, s: c.s }))
  }
  if (list.length !== T.count) return { err: '还贡数量不足' }
  list.forEach((c) => {
    const idx = room.game.players[cur.w].hand.findIndex((x) => x.r === c.r && x.s === c.s)
    if (idx >= 0) {
      const card = room.game.players[cur.w].hand.splice(idx, 1)[0]
      room.game.players[cur.target].hand.push(card)
      T.returned.push({ from: cur.w, to: cur.target, card: card })
      T.log.push({ text: playerName(room, cur.w) + ' 还 ' + cardName(card) + ' 给 ' + playerName(room, cur.target), kind: 'ret' })
    }
  })
  return {}
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

`
src = src.slice(0, A0) + tributeBlock + src.slice(A1)

// ---------- 3) tick 的 tribute 分支 ----------
const T0 = src.indexOf('    if (room.phase === \'tribute\') {')
const T1 = src.indexOf("    if (room.phase !== 'play') break", T0)
if (T0 < 0 || T1 < 0) throw new Error('tick anchor not found')

const newTick = `    if (room.phase === 'tribute') {
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
        const isAI = room.seats[T.turnW] && room.seats[T.turnW].ai
        if (T.stage === 'draw' && T.turnW >= 0 && isAI) {
          const avail = freeTargetsOf(T)
          if (avail.length) doTributeDraw(room, T.turnW, avail[0])
        }
        if (T.stage === 'draw' && T.turnW >= 0 && !T.current) {
          const avail = freeTargetsOf(T)
          if (avail.length) doTributeDraw(room, T.turnW, avail[0])
        }
        if (T.stage === 'return') doTributeReturn(room, null)
        advanceTributeRound(room)
        continue
      }
      break
    }
`
src = src.slice(0, T0) + newTick + src.slice(T1)

// ---------- 4) handle 增加 drawPick / return ----------
const H0 = src.indexOf("  } else if (action === 'next') {")
if (H0 < 0) throw new Error('handle anchor not found')

const newActions = `  } else if (action === 'drawPick') {
    if (room.phase === 'tribute') {
      const T = room.tributeShow
      if (T && T.stage === 'draw' && T.turnW === seat) {
        const target = (seat + (event.seatRel || 0) + 4) % 4
        if (freeTargetsOf(T).indexOf(target) >= 0) {
          doTributeDraw(room, seat, target)
          room.lastEvent = playerName(room, seat) + ' 抽牌'
        }
      }
    }
  } else if (action === 'return') {
    if (room.phase === 'tribute') {
      const T = room.tributeShow
      if (T && T.stage === 'return' && T.turnW === seat) {
        const r = doTributeReturn(room, event.cards || [])
        if (r && r.err) {
          await saveRoom(room)
          return { t: 'err', msg: r.err, state: viewFor(room, seat) }
        }
        advanceTributeRound(room)
        room.lastEvent = playerName(room, seat) + ' 还贡'
      }
    }
` + "  } else if (action === 'next') {"
src = src.slice(0, H0) + newActions + src.slice(H0 + "  } else if (action === 'next') {".length)

fs.writeFileSync(file, src, 'utf8')
console.log('patched index.js: 交互式进贡 + 抽牌互斥')
