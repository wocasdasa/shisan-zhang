const http = require('http');
const Client = require('./wsclient.js');
const PORT = Number(process.env.CDP_PORT || 9337);

http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, (r) => {
  let b = '';
  r.on('data', (d) => b += d);
  r.on('end', () => {
    const p = JSON.parse(b).find((x) => x.type === 'page');
    const c = new Client(p.webSocketDebuggerUrl);
    c.on('open', () => {
      const expr = `(function(){var S=window.__gx.S; for(var i=S.hits.length-1;i>=0;i--){var h=S.hits[i]; if(712>=h.x&&712<=h.x+h.w&&662>=h.y&&662<=h.y+h.h) return h.act+":"+h.i;} return "none";})()`;
      c.send({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } });
      c.on('message', (m) => {
        if (m.id === 1) { console.log('hit=', m.result.result.value); process.exit(0); }
      });
    });
  });
});
