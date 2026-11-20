const http = require('http');
const Client = require('./wsclient.js');
const PORT = Number(process.env.CDP_PORT || 9333);
const WANT = (process.env.ACT || 'play').split(',');

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
  const scale = Number(await ev('window.innerHeight')) / 750;
  const hits = JSON.parse(await ev('JSON.stringify(window.__app.S.hits)'));
  const click = async (x, y, tag) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await new Promise((r) => setTimeout(r, 300));
    console.log(tag, '-> selected', await ev('window.__app.S.selected.length'), 'hint', await ev('window.__app.S.hint'));
  };
  for (const act of WANT) {
    const hs = hits.filter((h) => h.act === act);
    if (!hs.length) { console.log('no hit', act); continue; }
    const h = hs[0];
    const x = Math.round((h.x + h.w / 2) * scale);
    const y = Math.round((h.y + h.h / 2) * scale);
    await click(x, y, act + ' @' + x + ',' + y);
  }
  c.close(); process.exit(0);
})();
