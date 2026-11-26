// 无头冒烟：在 Node 里打平 preview.html 的运行环境，驱动 demo=tributeSeq（2v2 第2局进贡全流程）
// 验证：无 JS 异常；进贡走完进入 play；桌面+手牌守恒 52 张；freeLosers 2v2 路径行为不变
// 用法：node tools/smoke-solo-tribute.js（结果写 tools/smoke-result.txt，exit 0=PASS）
const fs = require('fs');
const path = require('path');

const mroot = path.join(__dirname, '..', 'minigame');
const FILES = [
  'js/engine/cards.js', 'js/engine/rules.js', 'js/engine/camp.js', 'js/engine/info.js',
  'js/engine/hand.js', 'js/engine/moves.js', 'js/engine/table.js',
  'js/engine/ai.js', 'js/engine/ai2.js', 'js/engine/settle.js', 'js/engine/tribute.js',
  'js/engine/index.js', 'js/audio.js', 'js/net.js', 'js/platform.js', 'js/views/base.js', 'js/views/table.js', 'js/views/panels.js', 'js/views.js', 'js/app.js'
];

// ---- 浏览器环境打平 ----
const errors = [];
const gradient = { addColorStop() {} };
const ctx2d = new Proxy({}, {
  get(t, k) {
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => gradient;
    if (k === 'getImageData') return () => ({ data: [] });
    return typeof k === 'string' ? function () {} : undefined;
  },
  set() { return true; }
});
const canvasStub = {
  style: {}, width: 390, height: 844, clientWidth: 390, clientHeight: 844,
  getContext: () => ctx2d,
  addEventListener() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 })
};
const documentStub = {
  title: '',
  getElementById: () => canvasStub,
  addEventListener() {},
  createElement: () => canvasStub
};
const windowStub = {
  innerWidth: 390, innerHeight: 844, devicePixelRatio: 1,
  location: { search: '?demo=tributeSeq&auto=1' },
  addEventListener() {},
  document: documentStub
};
global.window = windowStub;
global.document = documentStub;
global.location = windowStub.location;
// rAF：跑有限帧，避免进程被渲染循环拖住
let rafCount = 0;
global.requestAnimationFrame = function (fn) {
  if (++rafCount > 4000) return 0;
  return setTimeout(fn, 0);
};
// 压缩所有定时器延迟，加速分步流程
const _setTimeout = global.setTimeout;
global.setTimeout = function (fn, delay) {
  const args = Array.prototype.slice.call(arguments, 2);
  return _setTimeout.apply(global, [fn, Math.min(delay || 0, 2)].concat(args));
};
let dumped = false;
function dump(code) {
  if (dumped) return; dumped = true;
  try { fs.writeFileSync(path.join(__dirname, 'smoke-result.txt'), 'EARLY-EXIT code=' + code + '\n' + errors.join('\n---\n'), 'utf8'); } catch (_) {}
}
process.on('uncaughtException', e => { errors.push('uncaught: ' + e.message + '\n' + e.stack); dump(1); process.exit(1); });
process.on('unhandledRejection', e => { errors.push('unhandledRejection: ' + e); dump(1); process.exit(1); });

// ---- define/require 微内核（与 build-mini-preview.js 同款）----
const defs = {};
global.define = function (p, fn) { defs[p] = fn; };
function resolve(from, p) {
  if (p.charAt(0) !== '.') return p;
  const seg = (from.split('/').slice(0, -1).join('/') + (from ? '/' : '') + p).split('/');
  const out = [];
  seg.forEach(s => { if (s === '..') out.pop(); else if (s !== '.' && s !== '') out.push(s); });
  return out.join('/');
}
const cache = {};
function makeRequire(from) {
  return function (p) {
    const key = resolve(from, p);
    if (cache[key]) return cache[key].exports;
    if (!defs[key]) throw new Error('module not found: ' + key);
    const m = { exports: {} };
    cache[key] = m;
    defs[key](makeRequire(key), m, m.exports);
    return m.exports;
  };
}
FILES.forEach(f => {
  const src = fs.readFileSync(path.join(mroot, f), 'utf8');
  global.eval('define(' + JSON.stringify(f) + ', function (require, module, exports) {\n' + src + '\n});');
});

const app = makeRequire('')('./js/app.js');
app.boot();

// ---- 轮询直到进贡结束（进入 play）或超时 ----
const t0 = Date.now();
const poll = setInterval(() => {
  const S = app.S;
  if (documentStub.title.indexOf('JSERROR') === 0) errors.push('window.onerror: ' + documentStub.title);
  if (errors.length) { finish(1); return; }
  if (S && S.phase === 'play') { finish(0); return; }
  if (Date.now() - t0 > 30000) { errors.push('timeout: phase=' + (S && S.phase) + ' stage=' + (S && S.tribute && S.tribute.stage)); finish(1); }
}, 50);

function finish(code) {
  clearInterval(poll);
  const S = app.S;
  const hands = S && S.game ? S.game.players.map(p => p.hand.length).join(',') : '?';
  const draws = S && S.tribute ? (S.tribute.draws || []).length : '?';
  const log = S && S.tribute ? (S.tribute.log || []).length : '?';
  let total = -1;
  if (S && S.game) {
    total = S.game.players.reduce((a, p) => a + p.hand.length, 0);
    (S.game.trickPlays || []).forEach(tp => { total += (tp.cards || []).length; });
  }
  const lines = [];
  lines.push('phase=' + (S && S.phase) + ' hands=[' + hands + '] 桌面+手牌总张数=' + total + ' draws=' + draws + ' log条数=' + log);
  if (S && S.tribute && S.tribute.drawnFrom) lines.push('drawnFrom=' + JSON.stringify(S.tribute.drawnFrom));
  if (S && S.tribute) lines.push('pairQuota=' + S.tribute.pairQuota);
  if (errors.length) { lines.push('ERRORS:'); errors.slice(0, 3).forEach(e => lines.push(e)); code = 1; }
  else if (code === 0 && total === 52) lines.push('SMOKE-PASS');
  else { lines.push('SMOKE-FAIL'); code = 1; }
  fs.writeFileSync(path.join(__dirname, 'smoke-result.txt'), lines.join('\n'), 'utf8');
  dumped = true;
  process.exit(code);
}
