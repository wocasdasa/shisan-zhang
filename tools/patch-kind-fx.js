// 补丁：按牌型分档的出牌特效与音效
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..', 'minigame')
const J = (f) => path.join(root, 'js', f)

function must(s, a, file) { if (!s.includes(a)) throw new Error('anchor missing in ' + file + ': ' + a.slice(0, 70)) }

// ---------- audio：牌型音档 ----------
let au = fs.readFileSync(J('audio.js'), 'utf8')
if (!au.includes('playKind')) {
  const anchor = `    toggle: function () { A.enabled = !A.enabled; resume(); return A.enabled; }`
  must(au, anchor, 'audio.js')
  au = au.replace(anchor, `    // 按牌型分档：牌越大，音越重
    playKind: function (k) {
      if (!A.enabled) return;
      if (!ready) init();
      function seq(freqs, dur, gain, gap, type) {
        for (var i = 0; i < freqs.length; i++) tone(freqs[i], dur, gain, type || 'triangle', null, i * gap);
      }
      if (k === 'pair') seq([660, 880], 0.06, 0.11, 0.07);
      else if (k === 'trio') seq([520, 660, 820], 0.07, 0.11, 0.07);
      else if (k === 'straight') seq([523, 659, 784, 988, 1175], 0.09, 0.09, 0.055);
      else if (k === 'flush') { noise(0.16, 2400, 0.28, 'highpass'); tone(880, 0.12, 0.1, 'sine', 1240); }
      else if (k === 'fullhouse') seq([392, 494, 587, 784], 0.1, 0.11, 0.085);
      else if (k === 'four') {
        tone(92, 0.22, 0.26, 'sine', 52);
        noise(0.14, 620, 0.34, 'lowpass');
        tone(224, 0.16, 0.16, 'square', 110);
      } else if (k === 'straightflush') {
        seq([523, 659, 784, 988, 1175, 1568], 0.1, 0.12, 0.05);
        noise(0.22, 3200, 0.3, 'highpass');
        tone(130, 0.2, 0.16, 'sine', 70);
      }
    },
${anchor}`)
  fs.writeFileSync(J('audio.js'), au, 'utf8')
}

// ---------- app：统一出牌特效入口 ----------
let ap = fs.readFileSync(J('app.js'), 'utf8')

if (!ap.includes('function fxPlayed(')) {
  const anchor = `  function scheduleAI() {`
  must(ap, anchor, 'app.js')
  ap = ap.replace(anchor, `  // 出牌瞬间：按牌型触发不同特效/音效
  function fxPlayed(g, seat) {
    var plays = (g && g.trickPlays) || [];
    var last = plays.length ? plays[plays.length - 1] : null;
    var k = (last && last.combo && last.combo.kind) || 'single';
    SFX.play('play');
    S.fx.playT0 = Date.now();
    S.fx.shockT0 = Date.now();
    S.fx.kind = k;
    SFX.play('shock');
    SFX.playKind(k);
    S.fx.seatPlay = { p: seat, t0: Date.now() };
  }

${anchor}`)
}

const blocks = [
  {
    a: `      SFX.play('play');
      S.fx.playT0 = Date.now();
      S.fx.shockT0 = Date.now();
      SFX.play('shock');
      S.fx.seatPlay = { p: 0, t0: Date.now() };`,
    b: `      fxPlayed(g, 0);`
  },
  {
    a: `    SFX.play('play');
    S.fx.playT0 = Date.now();
    S.fx.shockT0 = Date.now();
    SFX.play('shock');
    S.fx.seatPlay = { p: 0, t0: Date.now() };`,
    b: `    fxPlayed(g, 0);`
  },
  {
    a: `        SFX.play('play');
        S.fx.playT0 = Date.now();
        S.fx.shockT0 = Date.now();
        SFX.play('shock');
        S.fx.seatPlay = { p: p, t0: Date.now() };`,
    b: `        fxPlayed(S.game, p);`
  },
  {
    a: `          SFX.play('play');
          S.fx.playT0 = Date.now();
          S.fx.shockT0 = Date.now();
          SFX.play('shock');
          S.fx.seatPlay = { p: p, t0: Date.now() };`,
    b: `          fxPlayed(S.game, p);`
  },
  {
    a: `      SFX.play('play');
      S.fx.playT0 = Date.now();
      S.fx.seatPlay = { p: last.player, t0: Date.now() };`,
    b: `      fxPlayed(S.game, last.player);`
  }
]
for (const blk of blocks) {
  if (ap.includes(blk.a)) ap = ap.split(blk.a).join(blk.b)
}
fs.writeFileSync(J('app.js'), ap, 'utf8')

// ---------- views：牌型特效 ----------
let vw = fs.readFileSync(J('views.js'), 'utf8')

if (!vw.includes('function kindFx(')) {
  const anchor = `  function fxOverlay(ctx, S, L, H) {`
  must(vw, anchor, 'views.js')
  vw = vw.replace(anchor, `  // 牌型专属特效：环数、色带、闪光按牌型递进
  function kindFx(ctx, S, L, H, k, p) {
    var cx = W / 2;
    var cy = Math.min(L.center.y, L.hand.y - 90);
    var fade = Math.max(0, 1 - p);
    if (k === 'pair') {
      ring(ctx, cx, cy, 96, Math.min(1, p), '255,214,128');
      ring(ctx, cx, cy, 118, Math.min(1, p + 0.28), '255,238,190');
    } else if (k === 'trio') {
      ring(ctx, cx, cy, 104, Math.min(1, p), '255,206,120');
      ring(ctx, cx, cy, 128, Math.min(1, p + 0.18), '255,178,96');
      ring(ctx, cx, cy, 152, Math.min(1, p + 0.34), '255,226,170');
    } else if (k === 'straight') {
      for (var i = 0; i < 5; i++) {
        var d = easeOut(Math.min(1, Math.max(0, p * 1.4 - i * 0.08)));
        ctx.save();
        ctx.globalAlpha = 0.55 * fade;
        ctx.strokeStyle = 'rgba(160,214,255,0.9)';
        ctx.lineWidth = 2;
        var bw = 120 + d * 200;
        ctx.beginPath();
        ctx.moveTo(cx - bw / 2, cy + (i - 2) * 13);
        ctx.lineTo(cx + bw / 2, cy + (i - 2) * 13);
        ctx.stroke();
        ctx.restore();
      }
      burst(ctx, cx, cy, p, 16, 150, '160,214,255');
    } else if (k === 'flush') {
      ring(ctx, cx, cy, 110, Math.min(1, p), '150,220,255');
      ring(ctx, cx, cy, 140, Math.min(1, p + 0.22), '190,235,255');
      burst(ctx, cx, cy, p, 20, 168, '150,220,255');
    } else if (k === 'fullhouse') {
      ring(ctx, cx, cy, 112, Math.min(1, p), '214,168,255');
      ring(ctx, cx, cy, 138, Math.min(1, p + 0.2), '255,214,128');
      burst(ctx, cx, cy, p, 22, 172, '224,190,255');
    } else if (k === 'four') {
      ring(ctx, cx, cy, 150, Math.min(1, p * 0.9), '255,150,110');
      ring(ctx, cx, cy, 108, Math.min(1, p * 0.9 + 0.25), '255,214,128');
      burst(ctx, cx, cy, p, 30, 210, '255,164,120');
      ctx.save();
      ctx.globalAlpha = Math.max(0, 0.30 * (1 - p * 2.2));
      ctx.fillStyle = '#ffcf9a';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else if (k === 'straightflush') {
      var cols = ['255,140,120', '255,206,120', '255,246,180', '150,226,180', '150,206,255', '206,164,255'];
      for (var j = 0; j < 6; j++) {
        ring(ctx, cx, cy, 96 + j * 20, Math.min(1, p + j * 0.09), cols[j]);
      }
      burst(ctx, cx, cy, p, 34, 240, '255,240,200');
      ctx.save();
      ctx.globalAlpha = Math.max(0, 0.34 * (1 - p * 2.4));
      ctx.fillStyle = '#fff1c9';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else {
      ring(ctx, cx, cy, 120, Math.min(1, p), '255,216,140');
      burst(ctx, cx, cy, p, 18, 132, '255,216,140');
    }
  }

${anchor}`)
}

// ring 支持自定义颜色
vw = vw.replace(
  `  function ring(ctx, cx, cy, r, p) {
    var k = easeOut(p);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,216,140,' + (0.5 * (1 - p)).toFixed(3) + ')';`,
  `  function ring(ctx, cx, cy, r, p, rgb) {
    var k = easeOut(p);
    ctx.save();
    ctx.strokeStyle = 'rgba(' + (rgb || '255,216,140') + ',' + (0.5 * (1 - p)).toFixed(3) + ')';`
)

// fxOverlay：接入牌型特效
vw = vw.replace(
  `    if (S.fx.shockT0) {
      var p1 = (now - S.fx.shockT0) / 420;
      if (p1 >= 0 && p1 < 1) {
        var cy = Math.min(L.center.y, L.hand.y - 90);
        ring(ctx, W / 2, cy, 150, p1);
        burst(ctx, W / 2, cy, p1, 18, 132, '255,216,140');
      }
    }`,
  `    if (S.fx.playT0) {
      var pk = (now - S.fx.playT0) / 640;
      if (pk >= 0 && pk < 1) kindFx(ctx, S, L, H, S.fx.kind || 'single', pk);
    }`
)

fs.writeFileSync(J('views.js'), vw, 'utf8')
console.log('patched: kind fx + sfx')
