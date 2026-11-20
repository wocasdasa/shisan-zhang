// 补丁：进贡改为「翻牌舞台」——一张张从被抽者飞入中央翻出牌面
const fs = require('fs')
const path = require('path')

const file = path.resolve(__dirname, '..', 'minigame', 'js', 'views.js')
let src = fs.readFileSync(file, 'utf8')

const START = '  function tribute(ctx, S, L, hits) {'
const END = '  // ---------- 结算 ----------'
const i0 = src.indexOf(START)
const i1 = src.indexOf(END, i0)
if (i0 < 0 || i1 < 0) throw new Error('anchor not found')

const newFn = `  function cardTxt(c) {
    var r = c.r === 11 ? 'J' : c.r === 12 ? 'Q' : c.r === 13 ? 'K' : c.r === 14 ? 'A' : String(c.r);
    return SUIT[c.s] + r;
  }

  function tribute(ctx, S, L, hits) {
    var T = S.tribute;
    var land = L.landscape;
    var H = L.H;
    var now = Date.now();
    var per = 900;

    ctx.fillStyle = 'rgba(3,12,8,0.66)';
    ctx.fillRect(0, 0, W, H);

    var pw = Math.min(W - 56, 620);
    var ph = land ? Math.min(Math.max(232, H - 64), 268) : 320;
    var px = (W - pw) / 2;
    var py = Math.round((H - ph) / 2) - (land ? 4 : 16);
    box(ctx, px, py, pw, ph, 16, 'rgba(8,30,22,0.98)', C.panelLine);

    txt(ctx, '第 ' + S.round + ' 局 · 进贡', px + 24, py + 34, land ? 20 : 18, C.gold, 'left', 600);
    var wr = (T.plan.winnerRanks || []).join('、');
    txt(ctx, wr ? '胜方名次 ' + wr + ' · 每人抽 ' + T.plan.count + ' 张' : '',
      px + pw - 24, py + 34, land ? 14 : 12, C.dim, 'right');

    var draws = T.draws || [];
    var last = draws.length ? draws[draws.length - 1] : null;
    var cwm = land ? 100 : 96, chm = land ? 140 : 134;
    var cym = py + (land ? 60 : 66);
    var prog = last ? Math.min(1, Math.max(0, (now - (T.t0 || now)) / per)) : 1;

    if (!draws.length) {
      txt(ctx, T.stage === 'return' ? '选 ' + T.need + ' 张还贡' : '等待对手抽牌…',
        W / 2, cym + chm / 2 - 10, land ? 20 : 18, C.text, 'center', 600);
    } else {
      var e = easeOut(prog);
      var from = L.seats[SEAT_POS[last.from]];
      var fx = from.x + from.w / 2, fy = from.y + from.h / 2;
      var tx = W / 2, ty = cym + chm / 2;
      var gx = fx + (tx - fx) * e, gy = fy + (ty - fy) * e;
      var sc = 0.5 + 0.5 * e;
      ctx.save();
      ctx.globalAlpha = 0.45 + 0.55 * e;
      ctx.translate(gx, gy);
      ctx.rotate((1 - e) * 0.26);
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 14;
      drawCard(ctx, -cwm * sc / 2, -chm * sc / 2, cwm * sc, chm * sc, last.card, {});
      ctx.restore();

      if (prog >= 1) {
        txt(ctx, SEAT_NAMES[last.from] + ' 的牌被抽走', W / 2, cym - 20, land ? 13 : 12, C.dim, 'center');
        txt(ctx, cardTxt(last.card), W / 2, cym + chm + 22, land ? 20 : 18,
          (last.card.s === 0 || last.card.s === 2) ? '#e0503c' : '#efe8d6', 'center', 700);
      }

      var cur = Math.min(draws.length, Math.floor((now - (T.t0 || now)) / per) + 1);
      txt(ctx, '第 ' + cur + ' / ' + draws.length + ' 张', px + pw - 24, py + 34 + (land ? 26 : 24),
        land ? 13 : 12, C.gold, 'right');
    }

    // 已抽走的牌，一排小牌留在底部
    if (draws.length > 1) {
      var hw2 = 30, hh2 = 42, gp = 8;
      var shown = draws.slice(0, -1).slice(-8);
      var totalW = shown.length * (hw2 + gp) - gp;
      var hx2 = W / 2 - totalW / 2;
      var hy2 = py + ph - (land ? 82 : 96);
      shown.forEach(function (d, i) {
        drawCard(ctx, hx2 + i * (hw2 + gp), hy2, hw2, hh2, d.card, { dim: true });
        txt(ctx, SEAT_NAMES[d.from].charAt(0), hx2 + i * (hw2 + gp) + hw2 / 2, hy2 + hh2 + 11, 10, C.dim, 'center');
      });
    }

    var stage = T.stage === 'draw'
      ? (T.humanIsWinner ? '点对方座位抽牌（' + (T.humanDrawn || []).length + '/' + T.need + '）' : '对手正在抽牌…')
      : T.stage === 'return' ? '选 ' + T.need + ' 张还贡' : '进贡完成，即将开始出牌';
    txt(ctx, stage, px + 24, py + ph - 22, land ? 15 : 13,
      T.stage === 'done' ? C.gold : C.dim, 'left');

    if (T.stage === 'return' && T.humanIsWinner) {
      box(ctx, px + pw - 24 - 190, py + ph - 62, 190, 46, 10, C.gold, null);
      txt(ctx, '确认还贡', px + pw - 24 - 95, py + ph - 39, land ? 18 : 17, '#132018', 'center', 600);
      hits.push({ x: px + pw - 24 - 190, y: py + ph - 62, w: 190, h: 46, act: 'confirmReturn' });
    }
  }

`

src = src.slice(0, i0) + newFn + src.slice(i1)
fs.writeFileSync(file, src, 'utf8')
console.log('patched tribute -> 翻牌舞台')
