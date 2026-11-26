// 无头冒烟（独食进贡）：monkey-patch Tribute.plan 返回独食计划，驱动 app.js 单机分步流程
// 用法：node tools/smoke-lone-tribute.js（结果写 tools/smoke-lone-result.txt，exit 0=PASS）
//   SCENARIO=drawn  独食被抽方向：winners=[1,2,3] losers=[0] pairQuota=4，验证逐家交错 + 每胜方恰好4 + drawnFrom[0]=12
//   SCENARIO=lone   独食抽牌方向：winners=[1] losers=[0,2,3] pairQuota=4，验证每败方恰好被抽4（freeLosers 配额）
const fs = require('fs');
const path = require('path');
const SCENARIO = process.env.SCENARIO || 'drawn';

const mroot = path.join(__dirname, '..', 'minigame');
const FILES = [
  'js/engine/cards.js', 'js/engine/rules.js', 'js/engine/camp.js', 'js/engine/info.js',
  'js/engine/hand.js', 'js/engine/moves.js', 'js/engine/table.js',
  'js/engine/ai.js', 'js/engine/ai2.js', 'js/engine/settle.js', 'js/engine/tribute.js',
  'js/engine/index.js', 'js/audio.js', 'js/net.js', 'js/platform.js', 'js/views/base.js', 'js/views/table.js', 'js/views/panels.js', 'js/views.js', 'js/app.js'
];

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
  getContext: () => ctx2d, addEventListener() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 })
};
const documentStub = { title: '', getElementById: () => canvasStub, addEventListener() {}, createElement: () => canvasStub };
const windowStub = {
  innerWidth: 390, innerHeight: 844, devicePixelRatio: 1,
  location: { search: '?demo=tributeSeq&auto=1' },
  addEventListener() {}, document: documentStub
};
global.window = windowStub;
global.document = documentStub;
global.location = windowStub.location;
let rafCount = 0;
global.requestAnimationFrame = function (fn) { if (++rafCount > 6000) return 0; return setTimeout(fn, 0); };
const _setTimeout = global.setTimeout;
global.setTimeout = function (fn, delay) {
  const args = Array.prototype.slice.call(arguments, 2);
  return _setTimeout.apply(global, [fn, Math.min(delay || 0, 2)].concat(args));
};
let dumped = false;
function dump(code) {
  if (dumped) return; dumped = true;
  try { fs.writeFileSync(path.join(__dirname, 'smoke-lone-result.txt'), 'EARLY-EXIT code=' + code + '\n' + errors.join('\n---\n'), 'utf8'); } catch (_) {}
}
process.on('uncaughtException', e => { errors.push('uncaught: ' + e.message + '\n' + e.stack); dump(1); process.exit(1); });
process.on('unhandledRejection', e => { errors.push('unhandledRejection: ' + e); dump(1); process.exit(1); });

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

// ---- monkey-patch Tribute.plan：返回独食计划（忽略 demo 的 2v2 lastResult）----
const Tribute = makeRequire('')('./js/engine/tribute.js');
const fakePlan = SCENARIO === 'drawn'
  ? { winners: [1, 2, 3], losers: [0], drawer: 'others' }   // 独食第4：三家抽独食
  : { winners: [1], losers: [0, 2, 3], drawer: 'lone' };    // 独食第1：独食抽三家
Tribute.plan = function (lastResult, cfg) {
  return {
    count: 12, pairQuota: 4, winners: fakePlan.winners.slice(), losers: fakePlan.losers.slice(),
    winnerRanks: [1], tier: 'heavy', cfg: cfg, skip: false, loneRank: 1, drawer: fakePlan.drawer
  };
};

const app = makeRequire('')('./js/app.js');
app.boot();

let lastTrib = null;
const t0 = Date.now();
const poll = setInterval(() => {
  const S = app.S;
  if (documentStub.title.indexOf('JSERROR') === 0) { errors.push('window.onerror: ' + documentStub.title); finish(1); return; }
  if (S && S.phase === 'tribute' && S.tribute) {
    lastTrib = {
      counts: (S.tribute.counts || []).slice(),
      drawnFrom: JSON.parse(JSON.stringify(S.tribute.drawnFrom || {})),
      draws: (S.tribute.draws || []).map(d => d.from + '>' + d.to),
      humanRetDone: !!S.tribute.humanRetDone,
      stage: S.tribute.stage
    };
  }
  if (S && S.phase === 'play') { finish(0); return; }
  if (Date.now() - t0 > 30000) { errors.push('timeout phase=' + (S && S.phase) + ' stage=' + (S && S.tribute && S.tribute.stage)); finish(1); }
}, 10);

function finish(code) {
  clearInterval(poll);
  const S = app.S;
  let total = -1;
  if (S && S.game) {
    total = S.game.players.reduce((a, p) => a + p.hand.length, 0);
    (S.game.trickPlays || []).forEach(tp => { total += (tp.cards || []).length; });
  }
  const hands = S && S.game ? S.game.players.map(p => p.hand.length).join(',') : '?';
  const lines = ['SCENARIO=' + SCENARIO, 'phase=' + (S && S.phase) + ' hands=[' + hands + '] 总张数=' + total];
  const bad = [];
  if (!lastTrib) bad.push('never saw tribute phase');
  if (lastTrib) {
    lines.push('counts=' + JSON.stringify(lastTrib.counts));
    lines.push('drawnFrom=' + JSON.stringify(lastTrib.drawnFrom));
    lines.push('draws序列=' + lastTrib.draws.join(' '));
    if (SCENARIO === 'drawn') {
      // 每胜方恰好抽 4；drawnFrom[0]=12；交错：各胜方的抽牌段按 winners 顺序成块出现
      [1, 2, 3].forEach(w => {
        const n = lastTrib.draws.filter(d => d.endsWith('>' + w)).length;
        if (n !== 4) bad.push('winner ' + w + ' drew ' + n + ' != 4');
      });
      if ((lastTrib.drawnFrom[0] || 0) !== 12) bad.push('drawnFrom[0]=' + lastTrib.drawnFrom[0] + ' != 12');
      // 交错块检查：一旦某胜方开始抽，前一个胜方不得再出现
      const seq = lastTrib.draws.map(d => d.split('>')[1]).join(',');
      const blocks = seq.replace(/(\d)(,\1)*/g, '$1');
      if (blocks !== '1,2,3') bad.push('interleave blocks=' + blocks + ' != 1,2,3');
    } else {
      // 独食抽牌方向：每个败方恰好被抽 4
      [0, 2, 3].forEach(l => {
        const n = lastTrib.draws.filter(d => d.indexOf(l + '>') === 0).length;
        if (n !== 4) bad.push('loser ' + l + ' drawn ' + n + ' != 4');
        if ((lastTrib.drawnFrom[l] || 0) !== 4) bad.push('drawnFrom[' + l + ']=' + lastTrib.drawnFrom[l] + ' != 4');
      });
    }
  }
  if (total !== 52) bad.push('total cards=' + total + ' != 52');
  if (errors.length) { lines.push('ERRORS:'); errors.slice(0, 3).forEach(e => lines.push(e)); code = 1; }
  if (bad.length) { lines.push('ASSERT-FAIL:'); bad.forEach(b => lines.push(' - ' + b)); code = 1; }
  lines.push(code === 0 ? 'SMOKE-PASS' : 'SMOKE-FAIL');
  fs.writeFileSync(path.join(__dirname, 'smoke-lone-result.txt'), lines.join('\n'), 'utf8');
  dumped = true;
  process.exit(code);
}
