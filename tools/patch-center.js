// 一次性补丁：把 views.js 的 center() 换成斗地主式布局（最新一手放大居中，历史出牌缩小排在下方）
const fs = require('fs')
const path = require('path')

const file = path.resolve(__dirname, '..', 'minigame', 'js', 'views.js')
let src = fs.readFileSync(file, 'utf8')

const START = '  function center(ctx, S, L, hits) {'
const END = '  // 发牌：牌堆'
const i0 = src.indexOf(START)
const i1 = src.indexOf(END, i0)
if (i0 < 0 || i1 < 0) throw new Error('anchor not found')

const newFn = `  function center(ctx, S, L, hits) {
    var g = S.game;
    var cy = L.center.y;

    if (!g) {
      txt(ctx, '点右上「重开」开始', W / 2, cy, 20, C.dim);
      return;
    }

    var ds = dealState(S);
    if (ds && !ds.done) { dealTable(ctx, S, L, ds); return; }

    var plays = g.trickPlays || [];
    if (!plays.length) {
      txt(ctx, S.phase === 'play' && g.turn >= 0 ? SEAT_NAMES[g.turn] + ' 起手' : '', W / 2, cy, 19, C.dim);
      return;
    }

    var newest = plays[plays.length - 1];
    var hist = plays.slice(0, -1).slice(-4);

    // 最新一手：放大居中
    var n = newest.cards.length;
    var gap = n >= 8 ? 4 : 8;
    var maxW = Math.min(W - 280, 430);
    var cw = Math.floor((maxW - (n - 1) * gap) / n);
    cw = Math.max(30, Math.min(cw, n <= 2 ? 76 : n <= 5 ? 58 : 42));
    var ch = Math.round(cw * 1.38);
    var blockW = n * cw + (n - 1) * gap;
    var x0 = W / 2 - blockW / 2;
    var yTop = Math.max(cy - ch / 2, L.seats.north.y + L.seats.north.h + 26);
    yTop = Math.min(yTop, L.hand.y - ch - 62);

    var raw = fxProgress(S, 'playT0', 300);
    if (raw < 0.58) {
      var prog = easeOut(raw / 0.58);
      var from = L.seats[SEAT_POS[newest.player]];
      var fx0 = from.x + from.w / 2, fy0 = from.y + from.h / 2;
      var fx1 = W / 2, fy1 = yTop + ch / 2;
      var gx = fx0 + (fx1 - fx0) * prog;
      var gy = fy0 + (fy1 - fy0) * prog;
      var gw = cw * (0.58 + 0.42 * prog), gh = ch * (0.58 + 0.42 * prog);
      var mk = newest.cards[0].s === 3 && (newest.cards[0].r === 3 || newest.cards[0].r === 14);
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.45 * prog;
      ctx.translate(gx, gy);
      ctx.rotate((1 - prog) * (newest.player === 0 ? -0.16 : 0.16));
      for (var ci = newest.cards.length - 1; ci >= 0; ci--) {
        drawCard(ctx, -gw / 2 + ci * 9, -gh / 2 - ci * 3, gw, gh, newest.cards[ci],
          { mark: ci === 0 && mk });
      }
      ctx.restore();
      return;
    }

    box(ctx, x0 - 10, yTop - 32, blockW + 20, ch + 46, 6, 'rgba(4,26,17,0.34)', 'rgba(201,169,97,0.45)');
    txt(ctx, SEAT_NAMES[newest.player] + (newest.combo ? ' · ' + kindLabel(newest.combo.kind) : ''),
      W / 2, yTop - 16, 13, C.gold, 'center', 600);

    newest.cards.forEach(function (c, i) {
      var mark = c.s === 3 && (c.r === 3 || c.r === 14);
      drawCard(ctx, x0 + i * (cw + gap), yTop, cw, ch, c, { mark: mark });
    });

    // 本轮之前的出牌：缩小排在最新一手下方，保证一轮没结束前都看得到
    if (hist.length) {
      var hw = 24, hh = 33, hgap = 3;
      var groupsW = 0;
      hist.forEach(function (pl) { groupsW += pl.cards.length * (hw + hgap) + 16; });
      var hx = Math.max(20, W / 2 - groupsW / 2);
      var hy = yTop + ch + 10;
      hist.forEach(function (pl) {
        var bw = pl.cards.length * (hw + hgap);
        box(ctx, hx - 3, hy - 3, bw + 6, hh + 6, 4, 'rgba(4,26,17,0.28)', 'rgba(201,169,97,0.18)');
        pl.cards.forEach(function (c, i) {
          var mark = c.s === 3 && (c.r === 3 || c.r === 14);
          drawCard(ctx, hx + i * (hw + hgap), hy, hw, hh, c, { mark: mark, dim: true });
        });
        txt(ctx, SEAT_NAMES[pl.player].charAt(0), hx + 1, hy + hh + 10, 10, C.dim, 'left');
        hx += bw + 16;
      });
    }
  }

`

src = src.slice(0, i0) + newFn + src.slice(i1)
fs.writeFileSync(file, src, 'utf8')
console.log('patched center()')
