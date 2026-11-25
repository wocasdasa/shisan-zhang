// 联机冒烟：验证握手 → 建房 → 发言往返。ws:// 与 wss:// 都能跑
// 用法：node tools/wss-smoke.js wss://127.0.0.1:8788 --insecure
//   --insecure 仅用于自签证书的本地验证；生产域名应当是受信任证书
const url = process.argv[2] || process.env.URL || 'ws://127.0.0.1:8787';
const insecure = process.argv.indexOf('--insecure') >= 0;
if (insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
if (typeof WebSocket === 'undefined') {
  console.error('需要 Node >= 22（内置 WebSocket）');
  process.exit(1);
}

const TIMEOUT = Number(process.env.TIMEOUT || 6000);
const NAME = '冒烟' + Math.random().toString(36).slice(2, 6);
const TEXT = 'ping-' + Date.now().toString(36);
let step = 'connect';

const timer = setTimeout(() => {
  console.error('FAIL: 超时（卡在 ' + step + '）');
  try { ws.close(); } catch (e) {}
  process.exit(1);
}, TIMEOUT);

const ws = new WebSocket(url);

ws.addEventListener('open', () => {
  step = 'create';
  console.log('open ' + url);
  ws.send(JSON.stringify({ t: 'create', name: NAME, rounds: 8, cfg: { tributeTier: 'light' } }));
});

ws.addEventListener('error', (e) => {
  console.error('FAIL: 连接错误 ' + ((e && (e.message || e.error && e.error.message)) || ''));
  clearTimeout(timer);
  process.exit(1);
});

ws.addEventListener('message', (ev) => {
  let m;
  try { m = JSON.parse(ev.data); } catch (e) { return; }
  if (m.t === 'hello') return;

  if (m.t === 'joined') {
    step = 'chat';
    console.log('joined room=' + m.room + ' seat=' + m.seat);
    ws.send(JSON.stringify({ t: 'chat', kind: 'text', text: TEXT }));
    return;
  }

  if (m.t === 'state' && step === 'chat') {
    const got = (m.chat || []).some((c) => c.text === TEXT);
    if (!got) return;
    step = 'done';
    console.log('chat ok');
    clearTimeout(timer);
    try { ws.close(); } catch (e) {}
    console.log('PASS ' + url);
    process.exit(0);
  }

  if (m.t === 'err') {
    console.error('FAIL: ' + m.msg);
    clearTimeout(timer);
    process.exit(1);
  }
});
