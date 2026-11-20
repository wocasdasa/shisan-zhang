// 在 Node 里模拟最小浏览器环境，执行打包好的 HTML 脚本，抓运行时报错
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'ui', '独食牌桌.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
console.log('script 块数量:', scripts.length, '长度:', scripts.map(s => s.length).join(', '));

function node(id) {
  const n = {
    id,
    style: {},
    dataset: {},
    textContent: '',
    innerHTML: '',
    children: [],
    className: '',
    disabled: false,
    value: '8',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    querySelector() { return node(id + '-q'); },
    closest() { return null; },
    appendChild() {}
  };
  return n;
}

const nodes = {};
const ctx = {
  console,
  setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)),
  clearTimeout,
  Math,
  Date,
  JSON,
  Number,
  String,
  Array,
  Object,
  Set,
  Map,
  document: {
    getElementById(id) { return (nodes[id] = nodes[id] || node(id)); },
    addEventListener() {},
    querySelector() { return node('q'); }
  },
  confirm: () => true,
  addEventListener(ev, fn) { if (ev === 'DOMContentLoaded') ctx.__domReady = fn; },
  window: null
};
ctx.window = ctx;
ctx.globalThis = ctx;

const context = vm.createContext(ctx);

// 1) 引擎
try {
  vm.runInContext(scripts[0], context, { filename: 'engine.js' });
  const GX = ctx.GX;
  console.log('GX 模块:', GX ? Object.keys(GX) : 'undefined');
  const need = ['Cards', 'Rules', 'Hand', 'Camp', 'Info', 'Moves', 'Table', 'AI', 'AI2', 'Settle', 'Tribute'];
  const missing = need.filter(k => !GX || !GX[k]);
  console.log('缺失模块:', missing.length ? missing.join(', ') : '无');
} catch (e) {
  console.log('引擎报错:', e.message);
  process.exit(1);
}

// 2) UI
try {
  vm.runInContext(scripts[1], context, { filename: 'app.js' });
  console.log('UI 脚本执行完成（无抛错）');
} catch (e) {
  console.log('UI 报错:', e.message);
  console.log(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}

// 3) 触发 DOMContentLoaded，让 init 跑起来
try {
  const handler = ctx.__domReady;
  vm.runInContext('try { if (window.__domReady) window.__domReady(); } catch (e) { console.log("INIT_ERROR: " + e.message); }', context);
} catch (e) {
  console.log('init 报错:', e.message);
}

setTimeout(() => {
  console.log('牌面渲染：hand.innerHTML 长度 =', (nodes['hand'] ? nodes['hand'].innerHTML : '').length);
  console.log('轮次文本 =', nodes['roundInfo'] ? nodes['roundInfo'].textContent : '(无)');
  console.log('规则摘要 =', nodes['ruleSummary'] ? nodes['ruleSummary'].textContent : '(无)');
}, 60);
