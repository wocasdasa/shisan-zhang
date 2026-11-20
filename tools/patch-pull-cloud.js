// 补丁：进贡改为「摊牌手选」——点对手 → 他的牌背面摊一排 → 抽牌者自己点位置抽（服务端洗牌保证随机）
const fs = require('fs')
const path = require('path')

const file = path.resolve(__dirname, '..', 'minigame', 'cloudfunctions', 'gx13', 'index.js')
let src = fs.readFileSync(file, 'utf8')

// 1) AI 分支改用 autoTribute
src = src.replace(
`  if (isAI) {
    const avail = freeTargetsOf(T)
    if (avail.length) {
      doTributeDraw(room, w, avail[Math.floor(Math.random() * avail.length)])
      doTributeReturn(room, null)
    }
    T.r++
    pushTributeRound(room)
  }`,
`  if (isAI) {
    autoTribute(room)
    T.r++
    pushTributeRound(room)
  }`)

// 2) 替换 doTributeDraw 为「开牌堆 + 单张抽 + AI 自动」
const D0 = src.indexOf('function doTributeDraw(room, w, target) {')
const D1 = src.indexOf('function doTributeReturn(room, cards) {')
if (D0 < 0 || D1 < 0) throw new Error('doTributeDraw anchor missing')

const newDrawFns = `function openTributePull(room, target) {
  const T = room.tributeShow
  T.target = target
  T.pulled = 0
  T.stage = 'pull'
  T.current = null
  T.deadline = Date.now() + TRIBUTE_MS
}

// 抽一张：先把牌堆洗一遍再取第 idx 张 → 点哪个位置结果都是随机的
function pullOne(room, idx) {
  const T = room.tributeShow
  const P = room.game.players
  const target = T.target
  const w = T.turnW
  const pool = P[target].hand
  if (!pool.length) { T.stage = 'return'; return }
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
  if (T.pulled >= T.count) {
    if (T.picks.indexOf(target) < 0) T.picks.push(target)
    T.current = { w: w, target: target }
    T.stage = 'return'
    const isAI = room.seats[w] && room.seats[w].ai
    T.deadline = isAI ? 0 : Date.now() + TRIBUTE_MS
  }
}

// AI / 超时：自动挑人、抽满、还贡
function autoTribute(room) {
  const T = room.tributeShow
  const avail = freeTargetsOf(T)
  if (!avail.length) return
  const target = avail[Math.floor(Math.random() * avail.length)]
  openTributePull(room, target)
  for (let k = 0; k < T.count + 4; k++) {
    if (T.stage !== 'pull') break
    pullOne(room, Math.floor(Math.random() * 60))
  }
  if (T.stage === 'return') doTributeReturn(room, null)
}

`
src = src.slice(0, D0) + newDrawFns + src.slice(D1)

// 3) tick 超时分支适配 pull
const OLD_TICK = `      if (T.deadline && Date.now() >= T.deadline) {
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
      }`
const NEW_TICK = `      if (T.deadline && Date.now() >= T.deadline) {
        if (T.stage === 'draw' || T.stage === 'pull') autoTribute(room)
        else if (T.stage === 'return') doTributeReturn(room, null)
        advanceTributeRound(room)
        continue
      }`
if (!src.includes(OLD_TICK)) throw new Error('tick tribute block missing')
src = src.replace(OLD_TICK, NEW_TICK)

// 4) drawPick 改为开牌堆；新增 pullPick
src = src.replace(
`        const target = (seat + (event.seatRel || 0) + 4) % 4
        if (freeTargetsOf(T).indexOf(target) >= 0) {
          doTributeDraw(room, seat, target)
          room.lastEvent = playerName(room, seat) + ' 抽牌'
        }`,
`        const target = (seat + (event.seatRel || 0) + 4) % 4
        if (freeTargetsOf(T).indexOf(target) >= 0) {
          openTributePull(room, target)
          room.lastEvent = playerName(room, seat) + ' 摊开 ' + playerName(room, target) + ' 的牌'
        }`)

src = src.replace(
`  } else if (action === 'return') {`,
`  } else if (action === 'pullPick') {
    if (room.phase === 'tribute') {
      const T = room.tributeShow
      if (T && T.stage === 'pull' && T.turnW === seat) {
        pullOne(room, event.idx || 0)
        room.lastEvent = playerName(room, seat) + ' 抽走一张'
      }
    }
  } else if (action === 'return') {`)

// 5) view 增加 pull / targetRel
src = src.replace(
`      drawnFrom: (T.current ? [rel(T.current.target)] : []),`,
`      drawnFrom: (T.current ? [rel(T.current.target)] : []),
      pull: T.stage === 'pull' ? {
        targetRel: rel(T.target),
        n: room.game.players[T.target].hand.length,
        done: T.pulled || 0,
        count: T.count
      } : null,
      targetRel: (T.stage === 'pull' || T.stage === 'return') ? rel(T.target) : -1,`)

fs.writeFileSync(file, src, 'utf8')
console.log('cloud patched: 摊牌手选抽牌')
