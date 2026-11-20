// 补丁 v2：独食一次抽 3N 张（三家同时摊开），还贡按被抽牌大小逐张挑选
const fs = require('fs')
const path = require('path')

const file = path.resolve(__dirname, '..', 'minigame', 'cloudfunctions', 'gx13', 'index.js')
let src = fs.readFileSync(file, 'utf8')

// 1) rounds：每个 winner 只轮到一次（独食者一轮内抽完所有对手）
src = src.replace(
`  const rounds = []
  if (winners.length === 1) {
    // 独食胜：他一个人依次抽所有对手
    losers.forEach(() => rounds.push(winners[0]))
  } else {
    winners.forEach((w) => rounds.push(w))
  }`,
`  // 每个胜方只轮到一次；独食者一轮内把三家一起摊开、抽满 3N 张
  const rounds = winners.slice()`)

// 2) 替换 openTributePull / pullOne / autoTribute 整段
const A0 = src.indexOf('function openTributePull(room, target) {')
const A1 = src.indexOf('function doTributeReturn(room, cards) {')
if (A0 < 0 || A1 < 0) throw new Error('pull block anchor missing')

const newBlock = `function openTributePull(room, target) {
  const T = room.tributeShow
  // 独食：三家败方一起摊开，一轮抽 3N；2v2：只摊选中的那一家
  T.targets = (T.winners.length === 1) ? freeTargetsOf(T) : [target]
  T.target = target
  T.total = T.count * T.targets.length
  T.pulled = 0
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

  if (T.pulled >= T.total) {
    // 抽满 → 还贡：按被抽走的牌从大到小，一张一张还
    T.retQueue = T.draws.slice().sort((a, b) => -candOf(room, a.card, b.card))
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
    T.r++
    T.current = null
    pushTributeRound(room)
  }
  return {}
}

// AI / 超时：自动摊牌、抽满、逐张还
function autoTribute(room) {
  const T = room.tributeShow
  const avail = freeTargetsOf(T)
  if (!avail.length) return
  openTributePull(room, avail[Math.floor(Math.random() * avail.length)])
  let guard = 0
  while (T.stage === 'pull' && guard++ < T.total + 8) {
    const rows = T.targets.filter((s) => room.game.players[s].hand.length > 0)
    if (!rows.length) break
    pullOne(room, rows[Math.floor(Math.random() * rows.length)], Math.floor(Math.random() * 40))
  }
  guard = 0
  while (T.stage === 'return' && guard++ < T.total + 8) {
    retOne(room, null)
  }
}

`
src = src.slice(0, A0) + newBlock + src.slice(A1)

// 3) 删除旧的 doTributeReturn（逐轮整体还贡）—— 新流程改用 retOne
const R0 = src.indexOf('function doTributeReturn(room, cards) {')
const R1 = src.indexOf('function finishTribute(room) {')
if (R0 >= 0 && R1 > R0) {
  src = src.slice(0, R0) + src.slice(R1)
}

// 4) handle：pullPick 带 target；新增 retOne 动作
src = src.replace(
`  } else if (action === 'pullPick') {
    if (room.phase === 'tribute') {
      const T = room.tributeShow
      if (T && T.stage === 'pull' && T.turnW === seat) {
        pullOne(room, event.idx || 0)
        room.lastEvent = playerName(room, seat) + ' 抽走一张'
      }
    }`,
`  } else if (action === 'pullPick') {
    if (room.phase === 'tribute') {
      const T = room.tributeShow
      if (T && T.stage === 'pull' && T.turnW === seat) {
        const target = (seat + (event.seatRel || 0) + 4) % 4
        pullOne(room, target, event.idx || 0)
        room.lastEvent = playerName(room, seat) + ' 抽走一张'
      }
    }
  } else if (action === 'retOne') {
    if (room.phase === 'tribute') {
      const T = room.tributeShow
      if (T && T.stage === 'return' && T.turnW === seat) {
        const r = retOne(room, event.cards || [])
        if (r && r.err) {
          await saveRoom(room)
          return { t: 'err', msg: r.err, state: viewFor(room, seat) }
        }
        room.lastEvent = playerName(room, seat) + ' 还贡'
      }
    }`)

// 5) 旧 return 动作改走 retOne
src = src.replace(
`  } else if (action === 'return') {
    if (room.phase === 'tribute') {
      const T = room.tributeShow
      if (T && T.stage === 'return' && T.turnW === seat) {
        const r = doTributeReturn(room, event.cards || [])`,
`  } else if (action === 'return') {
    if (room.phase === 'tribute') {
      const T = room.tributeShow
      if (T && T.stage === 'return' && T.turnW === seat) {
        const r = retOne(room, event.cards || [])`)

// 6) tick 超时分支
src = src.replace(
`        if (T.stage === 'draw' || T.stage === 'pull') autoTribute(room)
        else if (T.stage === 'return') doTributeReturn(room, null)
        advanceTributeRound(room)
        continue`,
`        if (T.stage === 'draw' || T.stage === 'pull') {
          autoTribute(room)
          T.r++
          if (T.stage !== 'done') pushTributeRound(room)
        } else if (T.stage === 'return') {
          retOne(room, null)
        }
        continue`)

// 7) 旧的 advanceTributeRound 里 doTributeReturn 残留（retOne 内部已推进），只保留空函数兼容
src = src.replace(
`  } else if (action === 'return') {
    if (room.phase === 'tribute') {
      const T = room.tributeShow
      if (T && T.stage === 'return' && T.turnW === seat) {
        const r = retOne(room, event.cards || [])
        if (r && r.err) {
          await saveRoom(room)
          return { t: 'err', msg: r.err, state: viewFor(room, seat) }
        }
        advanceTributeRound(room)
        room.lastEvent = playerName(room, seat) + ' 还贡'
      }
    }`,
`  } else if (action === 'return') {
    if (room.phase === 'tribute') {
      const T = room.tributeShow
      if (T && T.stage === 'return' && T.turnW === seat) {
        const r = retOne(room, event.cards || [])
        if (r && r.err) {
          await saveRoom(room)
          return { t: 'err', msg: r.err, state: viewFor(room, seat) }
        }
        room.lastEvent = playerName(room, seat) + ' 还贡'
      }
    }`)

// 8) view：pull rows + ret 进度
src = src.replace(
`      pull: T.stage === 'pull' ? {
        targetRel: rel(T.target),
        n: room.game.players[T.target].hand.length,
        done: T.pulled || 0,
        count: T.count
      } : null,`,
`      pull: T.stage === 'pull' ? {
        rows: (T.targets || []).map((s) => ({ rel: rel(s), n: room.game.players[s].hand.length })),
        done: T.pulled || 0,
        total: T.total || 0,
        count: T.count
      } : null,
      ret: T.stage === 'return' && T.retQueue ? {
        need: T.retQueue.length - T.retIdx,
        idx: T.retIdx,
        total: T.retQueue.length,
        curFrom: rel(T.retQueue[T.retIdx] ? T.retQueue[T.retIdx].from : 0)
      } : null,`)

fs.writeFileSync(file, src, 'utf8')
console.log('cloud patched v2: 一次抽 3N + 逐张还贡')
