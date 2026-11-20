const http = require('http');
const Client = require('./wsclient.js');
const PORT = Number(process.env.CDP_PORT || 9336);
const ACT = process.env.ACT || 'card';

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
  await new Promise((r) => c.on('open', r));
  c.on('message', (m) => { if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (m, p) => new Promise((r) => { const i = ++id; pend.set(i, r); c.send({ id: i, method: m, params: p || {} }); });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.result.value;

  const scale = Number(await ev('window.innerHeight')) / 750;
  const h = JSON.parse(await ev('JSON.stringify(window.__gx.S.hits.filter(function(x){return x.act==="' + ACT + '"}))'))[0];
  const x = Math.round((h.x + h.w / 2) * scale), y = Math.round((h.y + h.h / 2) * scale);
  console.log('click', ACT, 'css', x, y, 'scale', scale);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await new Promise((r) => setTimeout(r, 80));
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await new Promise((r) => setTimeout(r, 400));
  console.log('platform:', await ev('JSON.stringify(window.__gx.P.debug())'));
  console.log('selected:', await ev('window.__gx.S.selected.length'), 'hint:', await ev('window.__gx.S.hint'));
  console.log('level:', await ev('window.__gx.S.level'), 'rounds:', await ev('window.__gx.S.rounds'), 'phase:', await ev('window.__gx.S.phase'));
  console.log('title:', await ev('document.title'));
  c.close(); process.exit(0);
})();
