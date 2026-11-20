// 一次性补丁：把 views.js 的 actions() 换成斗地主式圆形按钮，并新增 circleBtn()
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

    var cy = L.actions.y + 36;
    var r3 = 38, r2 = 30, r1 = 24;
    var cx3 = W - 24 - r3;
    var cx2 = cx3 - r3 - 12 - r2;
    var cx1 = cx2 - r2 - 10 - r1;

    if (S.timer.left > 0 && can) {
      txt(ctx, S.timer.left + 's', cx3, cy - r3 - 14, 18,
        S.timer.left <= 5 ? '#e8a5a3' : C.gold, 'center', 600);
    }

    var hint = S.hint || (can ? (g && g.combo ? '压过桌面或过牌' : '起手：出任意合法牌型') : '');
    if (hint) txt(ctx, hint, cx1 - r1 - 14, cy + 5, 15, C.dim, 'right');

    circleBtn(ctx, cx1, cy, r1, '提示', can, hits, 'hint');
    circleBtn(ctx, cx2, cy, r2, '过牌', can && g && g.combo, hits, 'pass');
    circleBtn(ctx, cx3, cy, r3, '出牌', can, hits, 'play', true);
  }

  function circleBtn(ctx, cx, cy, r, label, enabled, hits, act, primary) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    if (primary && enabled) {
      ctx.fillStyle = C.gold;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    } else {
      ctx.fillStyle = enabled ? C.btn : 'rgba(20,40,30,0.55)';
      ctx.fill();
      ctx.strokeStyle = enabled ? C.panelLine : 'rgba(201,169,97,0.12)';
    }
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    txt(ctx, label, cx, cy + r * 0.27, r >= 38 ? 19 : r >= 30 ? 16 : 14,
      (primary && enabled) ? '#132018' : enabled ? C.text : 'rgba(239,234,219,0.35)', 'center', 600);
    if (enabled) hits.push({ x: cx - r, y: cy - r, w: r * 2, h: r * 2, act: act });
  }

`

src = src.slice(0, i0) + newFn + src.slice(i1)
fs.writeFileSync(file, src, 'utf8')
console.log('patched actions()')
