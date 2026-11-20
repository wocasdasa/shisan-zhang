// 补丁：界面特效层（冲击环/粒子/撒花）+ 新音效（抽牌/还贡/滴答/按钮/打击感）
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..', 'minigame')
const J = (f) => path.join(root, 'js', f)

function patch(file, pairs) {
  let s = fs.readFileSync(file, 'utf8')
  for (const [a, b] of pairs) {
    if (!s.includes(a)) {
      if (s.includes(b)) { continue } // 已打过
      throw new Error('anchor missing in ' + file + ': ' + a.slice(0, 60))
    }
    s = s.split(a).join(b)
  }
  fs.writeFileSync(file, s, 'utf8')
}

// ---------- 1) 音效库 ----------
patch(J('audio.js'), [[
`  var bank = {
    deal: function () { noise(0.035, 1100, 0.3, 'bandpass'); },`,
`  var bank = {
    deal: function () { noise(0.035, 1100, 0.3, 'bandpass'); },
    tap: function () { tone(1150, 0.02, 0.055, 'square'); },
    draw: function () {
      noise(0.05, 3200, 0.42, 'highpass');
      tone(560, 0.075, 0.15, 'triangle', 980);
      tone(920, 0.09, 0.1, 'triangle', 1320, 0.06);
    },
    ret: function () {
      tone(720, 0.09, 0.14, 'sine', 470);
      tone(470, 0.12, 0.11, 'sine', 320, 0.09);
      noise(0.03, 950, 0.16, 'bandpass', 0.01);
    },
    tick: function () { tone(1020, 0.028, 0.09, 'square'); },
    shock: function () {
      tone(120, 0.15, 0.2, 'sine', 62);
      noise(0.09, 520, 0.3, 'lowpass');
    },`
]])

// ---------- 2) 特效层 ----------
patch(J('views.js'), [[
`  function fxProgress(S, key, dur) {`,
`  // ---------- 特效层 ----------
  function ring(ctx, cx, cy, r, p) {
    var k = easeOut(p);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,216,140,' + (0.5 * (1 - p)).toFixed(3) + ')';
    ctx.lineWidth = 3.2 * (1 - p) + 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r * (0.55 + 0.45 * k), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function burst(ctx, cx, cy, p, count, radius, rgb) {
    ctx.save();
    for (var i = 0; i < count; i++) {
      var a = (i / count) * Math.PI * 2 + (i % 3) * 0.18;
      var d = radius * easeOut(p) * (0.68 + ((i * 37) % 34) / 100);
      var x = cx + Math.cos(a) * d;
      var y = cy + Math.sin(a) * d * 0.62;
      ctx.fillStyle = 'rgba(' + rgb + ',' + Math.max(0, 1 - p).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(x, y, 2.4 * (1 - p) + 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  var CONFETTI_COLORS = ['255,216,140', '247,240,214', '226,120,92', '150,210,170'];

  function confetti(ctx, S, p, H) {
    var n = 36;
    ctx.save();
    for (var i = 0; i < n; i++) {
      var seed = (i * 73 + 11) % 997;
      var x = (seed / 997) * (W - 40) + 20 + Math.sin(p * 5 + i) * 22;
      var y = -30 + easeOut(Math.min(1, p * 1.15)) * (H + 80) * (0.35 + ((i * 29) % 60) / 100);
      var col = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p * 1.05);
      ctx.translate(x, y);
      ctx.rotate(p * 6 + i);
      ctx.fillStyle = 'rgba(' + col + ',1)';
      ctx.fillRect(-3, -5, 6, 10);
      ctx.restore();
    }
    ctx.restore();
  }

  function fxOverlay(ctx, S, L, H) {
    if (S.fxForce !== undefined && S.fxForce !== null) return;
    if (!S.fx) return;
    var now = Date.now();

    if (S.fx.shockT0) {
      var p1 = (now - S.fx.shockT0) / 420;
      if (p1 >= 0 && p1 < 1) {
        var cy = Math.min(L.center.y, L.hand.y - 90);
        ring(ctx, W / 2, cy, Math.min(W * 0.34, 250), p1);
        burst(ctx, W / 2, cy, p1, 20, 200, '255,216,140');
      }
    }
    if (S.fx.drawT0) {
      var p2 = (now - S.fx.drawT0) / 380;
      if (p2 >= 0 && p2 < 1) burst(ctx, W / 2, L.hand.y - 56, p2, 16, 160, '176,232,255');
    }
    if (S.fx.retT0) {
      var p3 = (now - S.fx.retT0) / 340;
      if (p3 >= 0 && p3 < 1) burst(ctx, W / 2, L.hand.y - 44, p3, 14, 130, '255,226,160');
    }
    if (S.fx.settleT0) {
      var p4 = (now - S.fx.settleT0) / 1000;
      if (p4 >= 0 && p4 < 1) confetti(ctx, S, p4, H);
    }
  }

  function fxProgress(S, key, dur) {`
], [
`    if (S.tribute) tribute(ctx, S, L, hits);
    if (S.phase === 'settle') settle(ctx, S, L, hits);`,
`    if (S.tribute) tribute(ctx, S, L, hits);
    fxOverlay(ctx, S, L, H);
    if (S.phase === 'settle') settle(ctx, S, L, hits);`
]])

// ---------- 3) 触发与重绘 ----------
patch(J('app.js'), [[
`    if (S.deal ||
      (S.fx.playT0 && now - S.fx.playT0 < 320) ||
      (S.fx.seatPlay && now - S.fx.seatPlay.t0 < 470) ||
      (S.fx.settleT0 && now - S.fx.settleT0 < 340)) P.markDirty();`,
`    if (S.deal ||
      (S.fx.playT0 && now - S.fx.playT0 < 320) ||
      (S.fx.shockT0 && now - S.fx.shockT0 < 440) ||
      (S.fx.drawT0 && now - S.fx.drawT0 < 400) ||
      (S.fx.retT0 && now - S.fx.retT0 < 360) ||
      (S.fx.seatPlay && now - S.fx.seatPlay.t0 < 470) ||
      (S.fx.settleT0 && now - S.fx.settleT0 < 1020)) P.markDirty();`
], [
`      S.fx.playT0 = Date.now();
      S.fx.seatPlay = { p: 0, t0: Date.now() };`,
`      S.fx.playT0 = Date.now();
      S.fx.shockT0 = Date.now();
      SFX.play('shock');
      S.fx.seatPlay = { p: 0, t0: Date.now() };`
], [
`    S.fx.playT0 = Date.now();
    S.fx.seatPlay = { p: 0, t0: Date.now() };`,
`    S.fx.playT0 = Date.now();
    S.fx.shockT0 = Date.now();
    SFX.play('shock');
    S.fx.seatPlay = { p: 0, t0: Date.now() };`
], [
`    SFX.play('play');
    if (T.pull.done >= (T.pull.total || T.need)) {`,
`    SFX.play('draw');
    S.fx.drawT0 = Date.now();
    if (T.pull.done >= (T.pull.total || T.need)) {`
], [
`    cards.forEach(function (c) { returnOneLocal(c); });
    SFX.play('play');`,
`    cards.forEach(function (c) { returnOneLocal(c); });
    SFX.play('ret');
    S.fx.retT0 = Date.now();`
], [
`      S.timer.left--;
      if (S.timer.left <= 0) {`,
`      S.timer.left--;
      if (S.timer.left > 0 && S.timer.left <= 5) SFX.play('tick');
      if (S.timer.left <= 0) {`
]])

// 在线收到对手出牌也补打击感
let a = fs.readFileSync(J('app.js'), 'utf8')
a = a.split(`        S.fx.playT0 = Date.now();
        S.fx.seatPlay = { p: p, t0: Date.now() };`).join(`        S.fx.playT0 = Date.now();
        S.fx.shockT0 = Date.now();
        SFX.play('shock');
        S.fx.seatPlay = { p: p, t0: Date.now() };`)
a = a.split(`          S.fx.playT0 = Date.now();
          S.fx.seatPlay = { p: p, t0: Date.now() };`).join(`          S.fx.playT0 = Date.now();
          S.fx.shockT0 = Date.now();
          SFX.play('shock');
          S.fx.seatPlay = { p: p, t0: Date.now() };`)
fs.writeFileSync(J('app.js'), a, 'utf8')

// 按钮点击音：在 onTap 命中按钮后播放
let t = fs.readFileSync(J('app.js'), 'utf8')
if (!t.includes("SFX.play('tap')")) {
  const anchor = `  function onTap(x, y) {`
  if (!t.includes(anchor)) throw new Error('onTap anchor missing')
  t = t.replace(anchor, `${anchor}
    SFX.play('tap');`)
  fs.writeFileSync(J('app.js'), t, 'utf8')
}

console.log('patched: fx + sfx')
