// 视觉回归：在 headless Chrome 里逐个 demo 模式采集「画布像素哈希 + 热区数组」。
// 用法：
//   node tools/shot-matrix.js .tools/vis-base            # 采集基线
//   node tools/shot-matrix.js .tools/vis-after           # 改完后采集
//   node tools/shot-matrix.js --compare .tools/vis-base .tools/vis-after
// 像素哈希用 FNV-1a 直接算 canvas ImageData，避免引入图像库。
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const Client = require('./wsclient.js');

const MODES = [
  'demo=testHand',
  'demo=tribute',
  'demo=pullTest&stage=draw',
  'demo=pullTest&stage=pull',
  'demo=pullTest&stage=pull3',
  'demo=pullTest&stage=return',
  'demo=fx',
  'demo=identity&seat=2&rank=3',
  'demo=lone&seat=2',
  'demo=flight',
  'demo=lobby',
  'demo=cfg',
  'demo=keypad',
  'demo=online',
  'demo=online&wait=1',
  'demo=online&chat=1',
  'demo=online&tools=1',
  'demo=online&pause=1',
  'demo=online&stats=1',
  'demo=online&record=1',
  'demo=online&replay=1',
  'demo=online&guide=1',
  'demo=online&settle=1',
  'demo=online&settle=1&skin=1'
];

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PREVIEW = process.env.PREVIEW || path.join(__dirname, '..', 'minigame', 'preview.html');
const WINDOW = process.env.WIN || '750,1268'; // 横屏用 1334,750

const EXPR = `(function(){
  var c = document.getElementById('game');
  if (!c) return JSON.stringify({ err: 'no canvas' });
  var ctx = c.getContext('2d');
  var d = ctx.getImageData(0, 0, c.width, c.height).data;
  var h = 2166136261;
  for (var i = 0; i < d.length; i += 4) {
    h = (h ^ d[i]) * 16777619;
    h = (h ^ d[i+1]) * 16777619;
    h = (h ^ d[i+2]) * 16777619;
    h = (h ^ d[i+3]) * 16777619;
  }
  var S = window.__gx && window.__gx.S;
  return JSON.stringify({
    title: document.title,
    hash: (h >>> 0) + 'x' + c.width + 'x' + c.height,
    phase: S ? S.phase : null,
    hits: S ? S.hits : null
  });
})()`;

const FREEZE_JS = `(function () {
  // 冻结时间与随机数：否则倒计时/粒子动画每一帧都不一样，无法做像素级比对
  var T = 1700000000000;
  try { Date.now = function () { return T; }; } catch (e) {}
  var seed = 987654321;
  try {
    Math.random = function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  } catch (e) {}
})();`;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function listPages(port) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/json/list' }, (r) => {
      let b = '';
      r.on('data', (d) => (b += d));
      r.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function waitForChrome(port) {
  for (let i = 0; i < 40; i++) {
    try {
      const pages = await listPages(port);
      const page = pages.find((p) => p.type === 'page');
      if (page) return page;
    } catch (e) { /* retry */ }
    await sleep(200);
  }
  throw new Error('Chrome 没有起来（端口 ' + port + '）');
}

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const c = new Client(wsUrl);
    let id = 0;
    const pend = new Map();
    c.on('open', () => {
      c.on('message', (m) => { if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
      const send = (method, params) => new Promise((res) => { const i = ++id; pend.set(i, res); c.send({ id: i, method, params: params || {} }); });
      resolve({ c, send });
    });
    c.on('error', reject);
  });
}

async function capture(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const port = Number(process.env.CDP_PORT || 9351);
  const profile = path.join(outDir, '.chrome-profile');
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--window-size=' + WINDOW,
    '--user-data-dir=' + profile,
    '--remote-debugging-port=' + port,
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    const page = await waitForChrome(port);
    const { c, send } = await connectCdp(page.webSocketDebuggerUrl);
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: FREEZE_JS });
    const results = {};

    for (const mode of MODES) {
      const url = 'file:///' + PREVIEW.replace(/\\/g, '/') + '?' + mode;
      await send('Page.navigate', { url });
      await sleep(Number(process.env.SETTLE_MS || 1100));
      const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
      const val = r.result && r.result.result && r.result.result.value;
      if (!val) { results[mode] = { error: 'evaluate failed' }; continue; }
      let parsed;
      try { parsed = JSON.parse(val); } catch (e) { parsed = { error: 'bad json: ' + val }; }
      results[mode] = parsed;
      console.log(mode + '  ' + (parsed.hash || parsed.error) + '  hits=' + (parsed.hits ? parsed.hits.length : '-') + (parsed.title && parsed.title.indexOf('JSERROR') === 0 ? '  ' + parsed.title : ''));
    }

    fs.writeFileSync(path.join(outDir, 'matrix.json'), JSON.stringify(results, null, 2), 'utf8');
    c.close();
    console.log('已写入 ' + path.join(outDir, 'matrix.json'));
  } finally {
    try { proc.kill(); } catch (e) {}
  }
}

function readMatrix(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'matrix.json'), 'utf8'));
}

function compare(aDir, bDir) {
  const a = readMatrix(aDir);
  const b = readMatrix(bDir);
  let same = 0, diff = 0, err = 0;
  const diffs = [];
  Object.keys(a).forEach((mode) => {
    const x = a[mode], y = b[mode];
    if (!y) { err++; diffs.push(mode + ': 另一侧缺失'); return; }
    if (x.error || y.error) { err++; diffs.push(mode + ': ' + (x.error || y.error)); return; }
    const titleBad = /^JSERROR/.test(y.title || '');
    const hitsSame = JSON.stringify(x.hits) === JSON.stringify(y.hits);
    if (x.hash === y.hash && hitsSame && !titleBad) { same++; return; }
    diff++;
    diffs.push(mode + ': hash ' + (x.hash === y.hash ? '同' : '不同') + ' / hits ' + (hitsSame ? '同' : '不同') + (titleBad ? ' / ' + y.title : ''));
  });
  console.log('一致 ' + same + ' / 差异 ' + diff + ' / 异常 ' + err);
  diffs.forEach((d) => console.log('  - ' + d));
  return diff === 0 && err === 0 ? 0 : 1;
}

const args = process.argv.slice(2);
if (args[0] === '--compare') {
  process.exit(compare(args[1], args[2]));
} else {
  capture(args[0] || path.join(__dirname, '..', '.tools', 'vis-out'))
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
