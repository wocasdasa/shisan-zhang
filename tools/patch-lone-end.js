// 补丁：独食者（已打出 ♠3 与 ♠A）先出完牌 → 本局立刻结束并定名次
const fs = require('fs')
const path = require('path')

const files = [
  path.resolve(__dirname, '..', 'engine', 'table.js'),
  path.resolve(__dirname, '..', 'minigame', 'js', 'engine', 'table.js'),
  path.resolve(__dirname, '..', 'minigame', 'cloudfunctions', 'gx13', 'engine', 'table.js')
]

const ANCHOR = `    if (game.players[player].hand.length === 0) finishPlayer(game, player);`

const ADD = `${ANCHOR}

    // 独食者（已亮出 ♠3 与 ♠A）先把牌打完 → 本局立即结束，其余按剩牌张数定名次
    var loneMe = game.players[player];
    if (loneMe.hand.length === 0 && (loneMe.revealedCards || []).length >= 2 && game.ranks.length === 1) {
      game.players.filter(function (x) { return x.hand.length > 0; })
        .sort(function (a, b) { return a.hand.length - b.hand.length; })
        .forEach(function (x) { game.ranks.push(x.id); });
      game.over = true;
      game.turn = -1;
      game.combo = null;
      return null;
    }`

files.forEach((f) => {
  let s = fs.readFileSync(f, 'utf8')
  if (s.includes('loneMe')) { console.log('already patched:', f); return }
  if (!s.includes(ANCHOR)) throw new Error('anchor not found: ' + f)
  s = s.replace(ANCHOR, ADD)
  fs.writeFileSync(f, s, 'utf8')
  console.log('patched:', f)
})
