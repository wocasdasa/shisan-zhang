// 快速人机局协议冒烟：单条 quick 消息必须完成建房、补 3 个机器人、直接发牌
// 用法：先起 node server/index.js，再 node tools/smoke-quick.js
const Client = require('./wsclient.js');

const URL = process.env.URL || 'ws://127.0.0.1:8787';
const c = new Client(URL);
let joinedRoom = '';
let sawWait = false;
let done = false;

function fail(msg) {
  if (done) return;
  done = true;
  console.error('QUICK-FAIL: ' + msg);
  try { c.close(); } catch (e) {}
  setTimeout(() => process.exit(1), 50);
}

function pass(msg) {
  if (done) return;
  done = true;
  console.log('QUICK-PASS: ' + msg);
  try { c.close(); } catch (e) {}
  setTimeout(() => process.exit(0), 50);
}

const timer = setTimeout(() => fail('5 秒内没有收到开局 state'), 5000);

c.on('error', (e) => fail('连接失败：' + (e && e.message ? e.message : e)));
c.on('open', () => {
  c.send({
    t: 'quick',
    name: 'quickbot',
    rounds: 8,
    cfg: { tributeTier: 'heavy', turnSeconds: 20, teamHint: 'none', testTribute: false }
  });
});

c.on('message', (m) => {
  if (m.t === 'err') return fail('服务端报错：' + m.msg);
  if (m.t === 'joined') {
    joinedRoom = m.room;
    return;
  }
  if (m.t !== 'state') return;
  // quick 内部会先广播一次等待房，再立刻发牌；等待态允许出现，但不能停在这里
  if (m.phase === 'wait') { sawWait = true; return; }
  if (m.phase !== 'deal' && m.phase !== 'play') {
    return fail('开局后 phase 应为 deal/play，实际 ' + m.phase);
  }
  if (!joinedRoom || m.room !== joinedRoom) return fail('state 房间号与 joined 不一致');
  if (m.round !== 1) return fail('第一局 round 应为 1，实际 ' + m.round);
  if (!m.host) return fail('快速开局创建者应为房主');
  if (!Array.isArray(m.seats) || m.seats.length !== 4) return fail('应返回 4 个座位');
  if (!m.seats[0] || m.seats[0].ai || !m.seats[0].isYou) return fail('0 号位应为真人自己');
  for (let i = 1; i < 4; i++) {
    const s = m.seats[i];
    if (!s || !s.ai) return fail(i + ' 号位应为机器人，实际 ' + JSON.stringify(s));
    if (s.name.indexOf('机器人') !== 0) return fail(i + ' 号位名字应为机器人N，实际 ' + s.name);
  }
  clearTimeout(timer);
  pass('房间 ' + m.room + '，phase=' + m.phase + '，座位=' +
    m.seats.map((s) => s.name + (s.ai ? '(AI)' : '')).join(' / '));
});
