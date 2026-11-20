// 用 Chrome DevTools 协议模拟点击，验证 canvas 触控是否生效
const http = require('http');
const Client = require('./wsclient.js');
const PORT = Number(process.env.CDP_PORT || 9333);

function getJSON(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  try {
    const list = await getJSON('/json/list');
    const page = list.find((p) => p.type === 'page');
    if (!page) throw new Error('没有页面');
    const c = new Client(page.webSocketDebuggerUrl);
    c.on('error', (e) => console.log('ws error:', e && e.message));
    let id = 0;
    const pending = new Map();
    const opened = new Promise((r) => c.on('open', r));
    c.on('message', (m) => {
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    });
    await opened;
    const send = (method, params) => new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      c.send({ id: mid, method, params: params || {} });
    });
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return r.result && r.result.result && r.result.result.value;
    };

    console.log('title:', await ev('document.title'));
    console.log('size:', await ev('window.innerWidth + "x" + window.innerHeight'));
    console.log('canvas:', await ev('(function(){var c=document.getElementById("game");return c.style.width+"/"+c.style.height+" buf="+c.width+"x"+c.height+" rect="+JSON.stringify(c.getBoundingClientRect());})()'));
    console.log('phase:', await ev('window.__app.S.phase'));
    console.log('hits:', await ev('window.__app.S.hits.length'));

    const hits = JSON.parse(await ev('JSON.stringify(window.__app.S.hits)'));
    const cardHit = hits.find((h) => h.act === 'card');
    console.log('cardHit:', JSON.stringify(cardHit));
    if (cardHit) {
      const wh = await ev('window.innerWidth + "," + window.innerHeight');
      const W = Number(wh.split(',')[0]);
      const H = Number(wh.split(',')[1]);
      const scale = Math.min(W / 750, H / 750);
      const x = (cardHit.x + 12) * scale;
      const y = (cardHit.y + cardHit.h / 2) * scale;
      console.log('click css at', x.toFixed(1), y.toFixed(1));
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 400));
      console.log('selected after click:', await ev('window.__app.S.selected.length'));
    }
    const acts = hits.map((h) => h.act);
    console.log('acts:', acts.join(','));
    c.close();
    process.exit(0);
  } catch (e) {
    console.log('probe failed:', e && e.message);
    process.exit(1);
  }
})();
