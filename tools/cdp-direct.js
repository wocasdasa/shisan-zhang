const http = require('http');
const Client = require('./wsclient.js');
const PORT = Number(process.env.CDP_PORT || 9335);

function getJSON(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
      let b = ''; r.on('data', (d) => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

(async () => {
  const list = await getJSON('/json/list');
  const page = list.find((x) => x.type === 'page');
  const c = new Client(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const opened = new Promise((r) => c.on('open', r));
  c.on('message', (m) => { if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  await opened;
  const send = (m, p) => new Promise((r) => { const i = ++id; pend.set(i, r); c.send({ id: i, method: m, params: p || {} }); });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.result.value;

  console.log('gx:', await ev('typeof window.__gx'));
  console.log('card hits y:', await ev('JSON.stringify(window.__gx.S.hits.filter(function(h){return h.act==="card"}).slice(0,2))'));
  console.log('direct onTap(703,662):', await ev('(window.__gx.onTap(703,662), window.__gx.S.selected.length)'));
  console.log('hint:', await ev('window.__gx.S.hint'));
  c.close(); process.exit(0);
})();
