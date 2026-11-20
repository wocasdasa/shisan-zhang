// 补丁：客户端接交互式进贡（选人抽牌/还贡）+ 进贡视觉 + 手牌再放大
const fs = require('fs')
const path = require('path')

const appFile = path.resolve(__dirname, '..', 'minigame', 'js', 'app.js')
let app = fs.readFileSync(appFile, 'utf8')

// 1) tribute 映射补字段
app = app.replace(
  `        stage: T.stage || 'draw',`,
  `        stage: T.stage || 'draw',
        canDraw: T.canDraw || [],
        turnW: (typeof T.turnWRel === 'number') ? T.turnWRel : -1,
        picks: T.picks || [],
        returned: T.returned || [],
        myTurn: !!T.myTurnToDraw,`
)
if (!app.includes('canDraw: T.canDraw')) throw new Error('tribute map patch failed')

// 2) 在线抽牌：改成 drawPick + 目标校验（同一对手不可被重复抽）
app = app.replace(
  `    if (S.mode === 'online') {
      var TV = S.tribute;
      if (!TV || TV.stage !== 'draw' || !TV.humanIsWinner) return;
      NET.send({ t: 'draw', seatRel: p });
      return;
    }`,
  `    if (S.mode === 'online') {
      var TV = S.tribute;
      if (!TV || TV.stage !== 'draw') return;
      if ((TV.canDraw || []).indexOf(p) < 0) { toast('这个人已经抽过了'); return; }
      NET.send({ t: 'drawPick', seatRel: p });
      return;
    }`
)
if (!app.includes("t: 'drawPick'")) throw new Error('drawFromSeat patch failed')

fs.writeFileSync(appFile, app, 'utf8')

// ---------------- views.js ----------------
const viewFile = path.resolve(__dirname, '..', 'minigame', 'js', 'views.js')
let v = fs.readFileSync(viewFile, 'utf8')

// 3) 手牌再放大
v = v.replace(
  `        hand: {
          y: H - 96,
          cardW: 86,
          cardH: 92,
          step: 44,
          x0: 152
        },`,
  `        hand: {
          y: H - 100,
          cardW: 96,
          cardH: 100,
          step: 46,
          x0: 148
        },`
)
v = v.replace('var handY0 = H - 96;', 'var handY0 = H - 100;')
if (!v.includes('cardW: 96')) throw new Error('hand patch failed')

// 4) 牌背绘制 helper（放在 box 之后）
v = v.replace(
  `  function txt(ctx, s, x, y, size, color, align, weight) {`,
  `  function drawBack(ctx, x, y, w, h) {
    box(ctx, x, y, w, h, Math.max(3, w * 0.1), '#2c5170', 'rgba(230,240,250,0.45)');
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#dce9f5';
    ctx.lineWidth = 1;
    for (var i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x + 2, y + h * i / 4);
      ctx.lineTo(x + w - 2, y + h * i / 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  function txt(ctx, s, x, y, size, color, align, weight) {`
)

// 5) 进贡阶段的座位视觉：对手牌全盖住 + 抽牌者/被抽者不同标记 + 抽到的牌挂在旁边
const SEAT_ANCHOR = `        hits.push({ x: rect.x - 6, y: rect.y - 6, w: rect.w + 12, h: rect.h + 12, act: 'drawSeat', p: p });`
if (!v.includes(SEAT_ANCHOR)) throw new Error('seat hit anchor not found')

const seatFx = `        hits.push({ x: rect.x - 6, y: rect.y - 6, w: rect.w + 12, h: rect.h + 12, act: 'drawSeat', p: p });

        // 进贡阶段：对手的牌全部盖住，只留牌背
        var TR = S.tribute;
        if (TR && S.phase === 'tribute') {
          for (var bk = 0; bk < 3; bk++) {
            ctx.save();
            ctx.translate(rect.x + rect.w - 24 + bk * 5, rect.y + rect.h / 2 - 15 + bk * 4);
            ctx.rotate(-0.1 + bk * 0.06);
            drawBack(ctx, 0, 0, 22, 30);
            ctx.restore();
          }
          var isTurn = TR.turnW === p;
          var canPick = TR.stage === 'draw' && (TR.canDraw || []).indexOf(p) >= 0;
          var wasPicked = (TR.picks || []).indexOf(p) >= 0;
          if (isTurn) {
            var pulse = 0.45 + 0.45 * Math.sin(Date.now() / 300);
            ctx.save();
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(233,184,77,' + pulse.toFixed(2) + ')';
            rr(ctx, rect.x - 7, rect.y - 7, rect.w + 14, rect.h + 14, 12);
            ctx.stroke();
            ctx.restore();
            txt(ctx, '抽牌中…', rect.x + rect.w / 2, rect.y - 13, 12, C.gold, 'center', 600);
          } else if (canPick) {
            var pulse2 = 0.55 + 0.4 * Math.sin(Date.now() / 240);
            ctx.save();
            if (ctx.setLineDash) ctx.setLineDash([6, 5]);
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = 'rgba(233,184,77,' + pulse2.toFixed(2) + ')';
            rr(ctx, rect.x - 9, rect.y - 9, rect.w + 18, rect.h + 18, 14);
            ctx.stroke();
            ctx.restore();
            var bx1 = rect.x + rect.w / 2;
            box(ctx, bx1 - 34, rect.y - 32, 68, 22, 11, 'rgba(233,184,77,0.95)', null);
            txt(ctx, '点我抽牌', bx1, rect.y - 21, 12, '#3b2a08', 'center', 600);
          } else if (wasPicked) {
            box(ctx, rect.x - 2, rect.y + rect.h - 2, 40, 18, 6, 'rgba(176,42,47,0.92)', null);
            txt(ctx, '已抽', rect.x + 18, rect.y + rect.h + 7, 11, '#ffe9e0', 'center', 600);
          }
          // 被抽走的牌挂在他座位旁（亮出来）
          var got = (TR.draws || []).filter(function (d) { return d.from === p; }).slice(-2);
          got.forEach(function (d, gi) {
            drawCard(ctx, rect.x + rect.w + 8, rect.y + 2 + gi * 32, 28, 36, d.card, {});
          });
        }`

v = v.replace(SEAT_ANCHOR, seatFx)

fs.writeFileSync(viewFile, v, 'utf8')
console.log('patched app.js + views.js (进贡交互/视觉/手牌)')
