// 联机体验用：开一个房间当房主，等真人进来后自动开局（不足 4 人由服务端补机器人）
const Client = require('./wsclient.js');
const GX = require('../engine/index.js');

const URL = process.env.URL || 'ws://127.0.0.1:8787';
const WAIT = Number(process.env.WAIT || 3000);
const cfg = GX.Rules.resolve();
const c = new Client(URL);
let started = false;
let pending = false;

c.on('open', () => c.send({ t: 'create', name: '房主', rounds: 12 }));
c.on('message', (m) => {
  if (m.t === 'joined') {
    console.log('ROOM=' + m.room);
    c.send({ t: 'ready', v: true });
    return;
  }
  if (m.t === 'err') { console.log('[房主] ' + m.msg); return; }
  if (m.t !== 'state') return;
  pending = false;
  if (m.phase === 'wait') {
    const humans = (m.seats || []).filter((s) => s && !s.ai && s.online).length;
    if (!started && humans >= 2) {
      started = true;
      setTimeout(() => c.send({ t: 'start' }), 1200);
      console.log('有 ' + humans + ' 位真人，1.2 秒后开局');
    }
    return;
  }
  const T = m.tribute;
  if (T) {
    if (T.myTurnToDraw && T.canDraw.length) {
      c.send({ t: 'draw', seatRel: T.canDraw[Math.floor(Math.random() * T.canDraw.length)] });
      return;
    }
    if (T.stage === 'return' && T.need > 0) {
      const give = (m.hand || []).slice()
        .filter((x) => !GX.Tribute.isIdentity(x))
        .sort((a, b) => GX.Rules.rankVal(a.r, cfg.rankOrder) - GX.Rules.rankVal(b.r, cfg.rankOrder))
        .slice(0, T.need);
      c.send({ t: 'return', cards: give });
    }
    return;
  }
  if (m.phase === 'settle') { setTimeout(() => c.send({ t: 'next' }), 500); return; }
  if (m.phase === 'play' && m.turn === 0 && !pending) {
    const cands = GX.Moves.candidates(m.hand, cfg);
    let pool = cands;
    if (m.combo) pool = cands.filter((x) => GX.Hand.compare(x.combo, m.combo) > 0);
    if (m.firstPlayPending) pool = pool.filter((x) => x.cards.some((y) => y.r === 4 && y.s === 0));
    const pick = GX.Moves.lowest(pool);
    pending = true;
    setTimeout(() => c.send(pick ? { t: 'play', cards: pick.cards } : { t: 'pass' }), 150);
  }
});

setTimeout(() => process.exit(0), 240000);
