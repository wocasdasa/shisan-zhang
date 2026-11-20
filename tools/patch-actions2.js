// 补丁：把操作区改成斗地主式按钮条（不出 / 圆形倒计时 / 提示 / 出牌）
const fs = require('fs')
const path = require('path')

const file = path.resolve(__dirname, '..', 'minigame', 'js', 'views.js')
let src = fs.readFileSync(file, 'utf8')

const START = '  function actions(ctx, S, L, hits) {'
const END = '  function btn(ctx, x, y, w, h, label, enabled, hits, act, primary) {'
const i0 = src.indexOf(START)
const i1 = src.indexOf(END, i0)
if (i0 < 0 || i1 < 0) throw new Error('anchor not found')

const newFn = `  function actions(ctx, S, L, hits) {
    var g = S.game;
    var can = S.phase === 'play' && g && !g.over && g.turn === 0 && !S.busy;

    var barH = 44;
    var barY = L.landscape ? (L.hand.y - barH - 8) : (L.hand.y - barH - 12);
    var wPass = 108, wHint = 108, wPlay = 126, rClock = 24, gapB = 12;
    var total = wPass + gapB + rClock * 2 + gapB + wHint + gapB + wPlay;
    var bx = Math.round(W / 2 - total / 2);

    pill(ctx, bx, barY, wPass, barH, '不出', can && g && !!g.combo, hits, 'pass', 'gold');
    bx += wPass + gapB;

    clockChip(ctx, bx + rClock, barY + barH / 2, rClock, S.timer.left, S.phase === 'play');
    bx += rClock * 2 + gapB;

    pill(ctx, bx, barY, wHint, barH, '提示', can, hits, 'hint', 'gold');
    bx += wHint + gapB;

    pill(ctx, bx, barY, wPlay, barH, '出牌', can, hits, 'play', 'blue');
  }

  function pill(ctx, x, y, w, h, label, enabled, hits, act, tone) {
    var r = h / 2;
    var fill = !enabled ? 'rgba(26,42,34,0.55)' : tone === 'blue' ? '#3b86d8' : '#e9b84d';
    var line = !enabled ? 'rgba(201,169,97,0.14)' : tone === 'blue' ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.5)';
    box(ctx, x, y, w, h, r, fill, line);
    if (enabled) {
      ctx.save();
      var lg = ctx.createLinearGradient(0, y, 0, y + h);
      lg.addColorStop(0, 'rgba(255,255,255,0.45)');
      lg.addColorStop(0.5, 'rgba(255,255,255,0.08)');
      lg.addColorStop(1, 'rgba(0,0,0,0.12)');
      rr(ctx, x, y, w, h, r);
      ctx.fillStyle = lg;
      ctx.fill();
      ctx.restore();
    }
    txt(ctx, label, x + w / 2, y + h / 2 + 1, 18,
      enabled ? (tone === 'blue' ? '#ffffff' : '#4a2f08') : 'rgba(239,234,219,0.4)', 'center', 600);
    if (enabled) hits.push({ x: x, y: y, w: w, h: h, act: act });
  }

  function clockChip(ctx, cx, cy, r, left, active) {
    var leftN = Math.max(0, left || 0);
    var warn = active && leftN <= 5;
    var ring = warn ? '#d8412f' : '#e9b84d';
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = active ? '#fffaf0' : 'rgba(255,255,255,0.34)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = ring;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - r * 0.46, cy - r * 0.94, r * 0.19, 0, Math.PI * 2);
    ctx.fillStyle = ring;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + r * 0.46, cy - r * 0.94, r * 0.19, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    txt(ctx, String(leftN), cx, cy + r * 0.3, Math.round(r * 0.92),
      warn ? '#d8412f' : '#5a3a12', 'center', 700);
  }

`

src = src.slice(0, i0) + newFn + src.slice(i1)
fs.writeFileSync(file, src, 'utf8')
console.log('patched actions -> 斗地主按钮条')
