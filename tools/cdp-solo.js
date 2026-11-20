const http = require('http');
const Client = require('./wsclient.js');
const PORT = Number(process.env.CDP_PORT || 9338);

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
  const tap = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await new Promise((r) => setTimeout(r, 250));
  };
  const scale = Number(await ev('window.innerHeight')) / 750;

  console.log('phase0:', await ev('window.__gx.S.phase'));
  await tap(Math.round(400 * scale), Math.round(500 * scale));
  console.log('after deal tap -> phase:', await ev('window.__gx.S.phase'), 'turn:', await ev('window.__gx.S.game ? window.__gx.S.game.turn : -1'));
  const hits = JSON.parse(await ev('JSON.stringify(window.__gx.S.hits.filter(function(h){return h.act==="card"}))'));
  if (hits.length) {
    const h = hits[0];
    await tap(Math.round((h.x + 12) * scale), Math.round((h.y + h.h / 2) * scale));
    console.log('selected:', await ev('window.__gx.S.selected.length'), 'hint:', await ev('window.__gx.S.hint'));
    // 再点第二张，验证多选
    const h2 = hits[1];
    await tap(Math.round((h2.x + 12) * scale), Math.round((h2.y + h2.h / 2) * scale));
    console.log('selected2:', await ev('window.__gx.S.selected.length'));
  } else {
    console.log('no card hits; acts=', await ev('window.__gx.S.hits.map(function(h){return h.act}).join(",")'));
  }
  c.close(); process.exit(0);
})();
