// Task 5 无头验证：联机 online 进贡映射（pairQuota/drawnFrom）+ 抽排"已满/剩X/Y"显示与热区抑制
// 场景：A 独食抽牌方向（winners=1，多败方行，cap/got 生效、抽满置灰无热区）
//       B 独食被抽方向（winners=3，单排，跨胜方合计不得置灰，保持"N 张"）
//       C 2v2（pairQuota=null，行为不变）  D 旧后端（不下发 pairQuota，行为不变）
// 用法：node tools/check-task5-online-map.js（exit 0=PASS）
const fs = require('fs');
const path = require('path');

const mroot = path.join(__dirname, '..', 'minigame');
const FILES = [
  'js/engine/cards.js', 'js/engine/rules.js', 'js/engine/camp.js', 'js/engine/info.js',
  'js/engine/hand.js', 'js/engine/moves.js', 'js/engine/table.js',
  'js/engine/ai.js', 'js/engine/ai2.js', 'js/engine/settle.js', 'js/engine/tribute.js',
  'js/engine/index.js', 'js/audio.js', 'js/net.js', 'js/platform.js', 'js/views.js', 'js/app.js'
];

// ---- 浏览器环境打平 ----
const gradient = { addColorStop() {} };
function makeCtx(rec) {
  const state = { alpha: 1 };
  const stack = [];
  return new Proxy({}, {
    get(t, k) {
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => gradient;
      if (k === 'getImageData') return () => ({ data: [] });
      if (k === 'save') return () => { stack.push(state.alpha); };
      if (k === 'restore') return () => { state.alpha = stack.length ? stack.pop() : 1; };
      if (k === 'fillText') return (s) => { if (rec) rec.texts.push({ text: String(s), alpha: state.alpha }); };
      if (k === 'fill') return () => { if (rec) rec.fills.push(state.alpha); };
      if (k === 'globalAlpha') return state.alpha;
      return typeof k === 'string' ? function () {} : undefined;
    },
    set(t, k, v) { if (k === 'globalAlpha') state.alpha = v; return true; }
  });
}
const canvasStub = {
  style: {}, width: 390, height: 844, clientWidth: 390, clientHeight: 844,
  getContext: () => makeCtx(null),
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
  location: { search: '' },
  addEventListener() {},
  document: documentStub
};
global.window = windowStub;
global.document = documentStub;
global.location = windowStub.location;
let rafCount = 0;
global.requestAnimationFrame = function (fn) {
  if (++rafCount > 2000) return 0;
  return setTimeout(fn, 0);
};
const _setTimeout = global.setTimeout;
global.setTimeout = function (fn, delay) {
  const args = Array.prototype.slice.call(arguments, 2);
  return _setTimeout.apply(global, [fn, Math.min(delay || 0, 2)].concat(args));
};
process.on('uncaughtException', e => { console.error('uncaught:', e); process.exit(1); });
process.on('unhandledRejection', e => { console.error('unhandledRejection:', e); process.exit(1); });

// ---- define/require 微内核 ----
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

// 先取 net 模块并包一层 on/send，捕获 app 注册的消息处理器与外发消息
const NET = makeRequire('')('./js/net.js');
const handlers = {};
const sent = [];
const _on = NET.on, _send = NET.send;
NET.on = function (evt, fn) { handlers[evt] = fn; return _on.call(NET, evt, fn); };
NET.send = function (o) { sent.push(o); return _send.call(NET, o); };

const VIEWS = makeRequire('')('./js/views.js');
const app = makeRequire('')('./js/app.js');
app.boot();

const fails = [];
function ok(cond, msg) { if (!cond) fails.push(msg); }

function mkHand() {
  const out = [];
  for (let i = 0; i < 13; i++) out.push({ r: 3 + (i % 13), s: i % 4 });
  return out;
}
function mkDraws(from, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ from: from, to: 0, card: { r: 5 + (i % 9), s: i % 4 } });
  return out;
}
function baseView(tribute) {
  return {
    t: 'state', room: 'AB12', phase: 'tribute', round: 2, rounds: 8,
    seats: [0, 1, 2, 3].map(i => ({ name: 'P' + i, ready: true, score: 0, count: 13 })),
    youSeatRel: 0, hand: mkHand(), trickPlays: [], turn: -1, combo: null,
    firstPlayPending: false, over: false, deadline: 0, host: true,
    tribute: Object.assign({
      stage: 'pull', winnerRanks: [1], canDraw: [], draws: [], reveals: [], log: [],
      need: 0, myTurnToDraw: false, pull: null, ret: null, targetRel: -1, turnWRel: 0,
      picks: [], returned: [], winnersRel: []
    }, tribute)
  };
}
function render(S) {
  const rec = { texts: [], fills: [] };
  const hits = VIEWS.draw(makeCtx(rec), S, 844) || [];
  return { rec: rec, hits: hits };
}
function textsOf(rec) { return rec.texts.map(t => t.text); }
function pullHits(hits, p) { return hits.filter(h => h.act === 'pullCard' && (p === undefined || h.p === p)); }

setTimeout(driveLobby, 30);

// 点菜单"联机"→"创建房间"→"创建"，驱动 bindNet 注册消息处理器（NET.connect 失败无害）
function tap(actName) {
  const S = app.S;
  const h = (S.hits || []).filter(x => x.act === actName)[0];
  if (!h) throw new Error('hit not found: ' + actName + '，现有 ' + (S.hits || []).map(x => x.act).join(','));
  window.__gx.onTap(h.x + h.w / 2, h.y + h.h / 2);
}
function driveLobby() {
  tap('netOpen');
  setTimeout(function () {
    tap('netConfig');
    setTimeout(function () {
      tap('netCfgConfirm');
      setTimeout(run, 10);
    }, 10);
  }, 10);
}

function run() {
  const S = app.S;
  ok(S, 'app.S 不可用');
  ok(typeof handlers.message === 'function', 'NET message 处理器未注册（bindNet 未执行）');

  // ---- 场景 A：独食抽牌方向（我是唯一胜方，三家败方行）----
  handlers.message(baseView({
    pairQuota: 4, pulledFrom: { 0: 99 }, // 绝对座位键且故意给错值，映射必须忽略它
    winnersRel: [0], canDraw: [1, 2, 3],
    draws: mkDraws(1, 4).concat(mkDraws(2, 3)),
    pull: { rows: [{ rel: 1, n: 9 }, { rel: 2, n: 10 }, { rel: 3, n: 13 }], done: 7, total: 12, count: 12 }
  }));
  let T = S.tribute;
  ok(T && T.pairQuota === 4, 'A: S.tribute.pairQuota 应为 4，实际 ' + (T && T.pairQuota));
  ok(T && T.drawnFrom && T.drawnFrom[1] === 4 && T.drawnFrom[2] === 3 && !T.drawnFrom[0],
    'A: drawnFrom 应由 draws 按 rel 计 {1:4,2:3}，实际 ' + JSON.stringify(T && T.drawnFrom));
  let rows = T.pull.rows;
  ok(rows[0].cap === 4 && rows[0].got === 4, 'A: row1 应 cap=4 got=4，实际 ' + JSON.stringify(rows[0]));
  ok(rows[1].cap === 4 && rows[1].got === 3, 'A: row2 应 cap=4 got=3，实际 ' + JSON.stringify(rows[1]));
  ok(rows[2].cap === 4 && rows[2].got === 0, 'A: row3 应 cap=4 got=0，实际 ' + JSON.stringify(rows[2]));

  let r1 = render(S);
  let tx1 = textsOf(r1.rec);
  ok(tx1.indexOf('已满') >= 0, 'A: 抽满行应显示"已满"，实际标签 ' + tx1.join('|'));
  ok(tx1.indexOf('剩 1/4') >= 0, 'A: 第二行应显示"剩 1/4"，实际 ' + tx1.join('|'));
  ok(tx1.indexOf('剩 4/4') >= 0, 'A: 第三行应显示"剩 4/4"，实际 ' + tx1.join('|'));
  ok(pullHits(r1.hits, 1).length === 0, 'A: 已满行不应有 pullCard 热区，实际 ' + pullHits(r1.hits, 1).length);
  ok(pullHits(r1.hits, 2).length === 10, 'A: 第二行应有 10 个 pullCard 热区，实际 ' + pullHits(r1.hits, 2).length);
  ok(pullHits(r1.hits, 3).length === 13, 'A: 第三行应有 13 个 pullCard 热区，实际 ' + pullHits(r1.hits, 3).length);
  ok(r1.rec.fills.indexOf(0.35) >= 0, 'A: 已满行牌背应以 alpha=0.35 绘制');
  ok(r1.rec.fills.filter(a => a === 1).length > 0, 'A: 未满行牌背应以 alpha=1 绘制');

  // ---- 场景 B：独食被抽方向（三位胜方，单排独食；合计 8 已超 per-winner 4 也不得置灰）----
  handlers.message(baseView({
    pairQuota: 4, pulledFrom: { 3: 8 },
    winnersRel: [0, 1, 2], canDraw: [3],
    draws: mkDraws(3, 8),
    pull: { rows: [{ rel: 3, n: 5 }], done: 2, total: 4, count: 4 }
  }));
  T = S.tribute;
  rows = T.pull.rows;
  ok(rows[0].cap === 4 && rows[0].got === 8, 'B: 行应带 cap=4 got=8（映射原样附加），实际 ' + JSON.stringify(rows[0]));
  const r2 = render(S);
  const tx2 = textsOf(r2.rec);
  ok(tx2.indexOf('5 张') >= 0, 'B: 被抽方向单排应保持"5 张"，实际 ' + tx2.join('|'));
  ok(tx2.indexOf('已满') < 0 && tx2.every(s => s.indexOf('剩 ') < 0), 'B: 被抽方向不得显示已满/剩X，实际 ' + tx2.join('|'));
  ok(pullHits(r2.hits, 3).length === 5, 'B: 单排 5 张应全部可点，实际 ' + pullHits(r2.hits, 3).length);
  ok(r2.rec.fills.indexOf(0.35) < 0, 'B: 被抽方向不得以 0.35 置灰');

  // ---- 场景 C：2v2（pairQuota=null，显示与热区维持现状）----
  handlers.message(baseView({
    pairQuota: null, pulledFrom: {},
    winnersRel: [0, 2], canDraw: [1, 3],
    draws: mkDraws(1, 1),
    pull: { rows: [{ rel: 1, n: 11 }, { rel: 3, n: 12 }], done: 1, total: 4, count: 4 }
  }));
  T = S.tribute;
  rows = T.pull.rows;
  ok(T.pairQuota === null, 'C: 2v2 pairQuota 应为 null，实际 ' + T.pairQuota);
  ok(rows[0].cap === undefined && rows[0].got === undefined, 'C: 2v2 行不得附加 cap/got，实际 ' + JSON.stringify(rows[0]));
  const r3 = render(S);
  const tx3 = textsOf(r3.rec);
  ok(tx3.indexOf('11 张') >= 0 && tx3.indexOf('12 张') >= 0, 'C: 2v2 应保持"N 张"，实际 ' + tx3.join('|'));
  ok(pullHits(r3.hits, 1).length === 11 && pullHits(r3.hits, 3).length === 12, 'C: 2v2 热区数量不应变化');

  // ---- 场景 D：旧后端（不下发 pairQuota/pulledFrom，显示维持现状）----
  handlers.message(baseView({
    winnersRel: [0], canDraw: [1],
    draws: [],
    pull: { rows: [{ rel: 1, n: 13 }], done: 0, total: 2, count: 2 }
  }));
  T = S.tribute;
  rows = T.pull.rows;
  ok(T.pairQuota === null, 'D: 旧后端 pairQuota 应按 null 处理，实际 ' + T.pairQuota);
  ok(rows[0].cap === undefined, 'D: 旧后端行 cap 应为 undefined，实际 ' + JSON.stringify(rows[0]));
  const r4 = render(S);
  const tx4 = textsOf(r4.rec);
  ok(tx4.indexOf('13 张') >= 0, 'D: 旧后端应保持"13 张"，实际 ' + tx4.join('|'));
  ok(pullHits(r4.hits, 1).length === 13, 'D: 旧后端热区不应变化');

  const lines = [];
  lines.push('场景A（独食抽牌方向 cap/got/置灰/热区抑制）: ' + (fails.filter(f => f[0] === 'A').length ? 'FAIL' : 'PASS'));
  lines.push('场景B（被抽方向单排不误判置灰）: ' + (fails.filter(f => f[0] === 'B').length ? 'FAIL' : 'PASS'));
  lines.push('场景C（2v2 零变化）: ' + (fails.filter(f => f[0] === 'C').length ? 'FAIL' : 'PASS'));
  lines.push('场景D（旧后端零变化）: ' + (fails.filter(f => f[0] === 'D').length ? 'FAIL' : 'PASS'));
  if (fails.length) { lines.push('FAILURES:'); fails.forEach(f => lines.push(' - ' + f)); }
  else lines.push('CHECK-PASS');
  console.log(lines.join('\n'));
  fs.writeFileSync(path.join(__dirname, 'check-task5-result.txt'), lines.join('\n'), 'utf8');
  process.exit(fails.length ? 1 : 0);
}
