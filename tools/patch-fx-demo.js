// 补丁：特效预览开关 ?demo=fx&fx=0.35
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..', 'minigame')
const views = path.join(root, 'js', 'views.js')
const app = path.join(root, 'js', 'app.js')

let v = fs.readFileSync(views, 'utf8')
if (!v.includes('S.fxDemoP')) {
  const anchor = `  function fxOverlay(ctx, S, L, H) {
    if (S.fxForce !== undefined && S.fxForce !== null) return;`
  if (!v.includes(anchor)) throw new Error('fxOverlay anchor missing')
  v = v.replace(anchor, `  function fxOverlay(ctx, S, L, H) {
    if (S.fxDemoP !== undefined && S.fxDemoP !== null) {
      var dp = S.fxDemoP;
      var dcy = Math.min(L.center.y, L.hand.y - 90);
      ring(ctx, W / 2, dcy, Math.min(W * 0.34, 250), dp);
      burst(ctx, W / 2, dcy, dp, 20, 200, '255,216,140');
      burst(ctx, W / 2, L.hand.y - 56, dp, 16, 160, '176,232,255');
      burst(ctx, W / 2, L.hand.y - 44, dp, 14, 130, '255,226,160');
      confetti(ctx, S, Math.min(1, dp * 1.2), H);
      return;
    }
    if (S.fxForce !== undefined && S.fxForce !== null) return;`)
  fs.writeFileSync(views, v, 'utf8')
}

let a = fs.readFileSync(app, 'utf8')
if (!a.includes('demoFx')) {
  const anchor = `        /demo=flight/.test(window.location.search || '')) { demoFlight(); return; }`
  if (!a.includes(anchor)) throw new Error('demo list anchor missing')
  a = a.replace(anchor, `        /demo=fx/.test(window.location.search || '')) { demoFx(); return; }
` + anchor)
  a = a.replace(`  function demoFlight() {`, `  function demoFx() {
    var m = /fx=([0-9.]+)/.exec(window.location.search || '');
    newMatch();
    S.fxDemoP = m ? parseFloat(m[1]) : 0.35;
    P.markDirty();
  }

  function demoFlight() {`)
  fs.writeFileSync(app, a, 'utf8')
}
console.log('patched: fx demo hook')
