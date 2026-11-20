// 每 200ms 采样一次进贡流程状态
const http = require('http');
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

  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    const s = await ev(`(function(){var S=window.__gx.S;var T=S.tribute;return S.phase+'|'+(T?T.stage:'-')+'|'+(T?T.draws.length:0)+'|'+(T?T.log.length:0)+'|'+S.hint;})()`);
    console.log(((Date.now() - t0) + 'ms').padStart(7), s);
    if (s.indexOf('play|') === 0 && s.split('|')[2] !== '0') { /* keep going */ }
    await sleep(200);
  }
  c.close(); process.exit(0);
})();
