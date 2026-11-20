const http = require('http');
const fs = require('fs');
const Client = require('./wsclient.js');
const PORT = Number(process.env.CDP_PORT || 9343);

http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, (r) => {
  let b = ''; r.on('data', (d) => b += d);
  r.on('end', async () => {
    const p = JSON.parse(b).find((x) => x.type === 'page');
    const c = new Client(p.webSocketDebuggerUrl);
    let id = 0; const pend = new Map();
    await new Promise((res) => c.on('open', res));
    c.on('message', (m) => { if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    const send = (m, q) => new Promise((res) => { const i = ++id; pend.set(i, res); c.send({ id: i, method: m, params: q || {} }); });
    const wait = Number(process.env.WAIT || 1500);
    await new Promise((res) => setTimeout(res, wait));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(process.env.OUT || 'shot.png', Buffer.from(shot.result.data, 'base64'));
    console.log('saved', process.env.OUT);
    c.close(); process.exit(0);
  });
});
