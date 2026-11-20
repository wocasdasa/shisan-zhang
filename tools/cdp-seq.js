// 按时间顺序截取几帧，并回读状态（用于核对进贡分步流程）
const http = require('http');
const fs = require('fs');
const Client = require('./wsclient.js');
const PORT = Number(process.env.CDP_PORT || 9341);

function getJSON(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
      let b = ''; r.on('data', (d) => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const list = await getJSON('/json/list');
  const page = list.find((x) => x.type === 'page');
  const c = new Client(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  await new Promise((r) => c.on('open', r));
  c.on('message', (m) => { if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (m, p) => new Promise((r) => { const i = ++id; pend.set(i, r); c.send({ id: i, method: m, params: p || {} }); });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.result.value;
  const shot = async (path) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path, Buffer.from(r.result.data, 'base64'));
    console.log('shot', path);
  };
  const state = async (tag) => {
    console.log(tag, '| phase', await ev('window.__gx.S.phase'),
      '| stage', await ev('window.__gx.S.tribute ? window.__gx.S.tribute.stage : "-"'),
      '| draws', await ev('window.__gx.S.tribute ? window.__gx.S.tribute.draws.length : 0'),
      '| logs', await ev('window.__gx.S.tribute ? window.__gx.S.tribute.log.length : 0'),
      '| hint', await ev('window.__gx.S.hint'));
  };

  await sleep(900);
  await state('t=0.9s');
  await shot(process.env.SHOT1 || 'seq1.png');
  await sleep(2200);
  await state('t=3.1s');
  await shot(process.env.SHOT2 || 'seq2.png');
  await sleep(2500);
  await state('t=5.6s');
  c.close(); process.exit(0);
})();
