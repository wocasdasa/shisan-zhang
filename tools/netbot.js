// 联机自测：4 个机器人客户端打满全局，验证服务端回合/进贡/计分
const Client = require('./wsclient.js');
const GX = require('../engine/index.js');

const URL = process.env.URL || 'ws://127.0.0.1:8787';
const ROUNDS = Number(process.env.ROUNDS || 8);
const REMATCH = process.env.REMATCH === '1';
const cfg = GX.Rules.resolve();

const bots = [];
let started = false;
let finished = false;
let lastRound = 0;
let actions = 0;
let rematchAsked = false;
let rematchDone = false;

function decide(view) {
  const hand = view.hand;
  if (!hand || !hand.length) return null;
  const cands = GX.Moves.candidates(hand, cfg);
  if (!view.combo) {
    let pool = cands;
    if (view.firstPlayPending) {
      pool = cands.filter((c) => c.cards.some((x) => x.r === 4 && x.s === 0));
    }
    if (!pool.length) pool = cands;
    const pick = GX.Moves.lowest(pool);
    return pick ? { t: 'play', cards: pick.cards } : null;
  }
  const beat = cands.filter((c) => GX.Hand.compare(c.combo, view.combo) > 0);
  if (!beat.length) return { t: 'pass' };
  const pick = GX.Moves.lowest(beat);
  return pick ? { t: 'play', cards: pick.cards } : { t: 'pass' };
}

function makeBot(i) {
  const c = new Client(URL);
  const name = 'bot' + (i + 1);
  c.on('open', () => {
    if (i === 0) c.send({ t: 'create', name, rounds: ROUNDS });
    else {
      const wait = setInterval(() => {
        if (bots[0].roomId) { clearInterval(wait); c.send({ t: 'join', name, room: bots[0].roomId }); }
      }, 120);
      setTimeout(() => clearInterval(wait), 8000);
    }
  });
  c.on('message', (m) => {
    if (m.t === 'joined') {
      c.roomId = m.room;
      setTimeout(() => c.send({ t: 'ready', v: true }), 60);
      return;
    }
    if (m.t === 'err') {
      if (m.msg !== '还没轮到你') console.log('[' + name + '] 服务端提示：' + m.msg);
      return;
    }
    if (m.t !== 'state') return;

    if (m.round !== lastRound) {
      lastRound = m.round;
      console.log('—— 第 ' + m.round + ' / ' + m.rounds + ' 局，phase=' + m.phase);
    }
    if (m.phase !== c.lastPhase) {
      c.lastPhase = m.phase;
      console.log('[' + name + '] phase→' + m.phase + ' turn=' + m.turn +
        ' round=' + m.round + (m.tribute ? ' 贡:' + m.tribute.stage + ' 需' + m.tribute.need : ''));
    }

    c.pending = false;

    if (m.phase === 'summary') {
      if (REMATCH) {
        if (!rematchAsked) {
          rematchAsked = true;
          console.log('全场结束（' + m.round + '/' + m.rounds + ' 局），请求再来一场；分数=' + JSON.stringify(m.summary && m.summary.scores));
          if (m.host) setTimeout(() => c.send({ t: 'next' }), 300);
        }
        return;
      }
      if (!finished) {
        finished = true;
        console.log('全场结束，累计分（bot1视角，你/左/上/右）：' + JSON.stringify(m.summary.scores));
        console.log('总步数：' + actions);
        setTimeout(() => { bots.forEach((b) => b.close()); process.exit(0); }, 300);
      }
      return;
    }

    if (rematchAsked && !rematchDone && m.round === 1 && (m.phase === 'deal' || m.phase === 'play')) {
      rematchDone = true;
      console.log('REMATCH-PASS：已重开第 1 局，phase=' + m.phase + '，分数=' + JSON.stringify((m.seats || []).map((s) => s.score)));
      setTimeout(() => { bots.forEach((b) => b.close()); process.exit(0); }, 500);
      return;
    }

    if (m.phase === 'wait') {
      if (i === 0 && !started && bots.every((b) => b.roomId)) {
        started = true;
        setTimeout(() => c.send({ t: 'start' }), 700);
      }
      return;
    }

    if (m.tribute) {
      const T = m.tribute;
      if (T.myTurnToDraw) {
        if (Date.now() - (c.lastDrawAt || 0) < 600) return;   // 防同一状态连点：测试端也要去重
        const pool = (T.canDraw || []).filter((r) => {
          const loneDraw = !!(T.pairQuota != null && (T.winnersRel || []).length === 1);
          return !loneDraw || ((T.pulledFrom || {})[r] || 0) < T.pairQuota;
        });
        if (!pool.length) return;
        const rel = pool[Math.floor(Math.random() * pool.length)];
        c.lastDrawAt = Date.now();
        setTimeout(() => c.send({ t: 'draw', seatRel: rel }), 260);
        return;
      }
      if (T.stage === 'return' && T.need > 0) {
        const give = m.hand.slice().sort((a, b) => {
          const va = GX.Rules.rankVal(a.r, cfg.rankOrder), vb = GX.Rules.rankVal(b.r, cfg.rankOrder);
          if (va !== vb) return va - vb;
          return a.s - b.s;
        }).slice(0, T.need);
        setTimeout(() => c.send({ t: 'return', cards: give }), 260);
        return;
      }
      return;
    }

    if (m.phase === 'settle') {
      if (m.host) setTimeout(() => c.send({ t: 'next' }), 600);
      return;
    }

    if (m.phase === 'play' && m.turn === 0 && !c.pending) {
      const act = decide(m);
      if (!act) return;
      c.pending = true;
      actions++;
      setTimeout(() => c.send(act), 120 + Math.floor(Math.random() * 90));
    }
  });
  return c;
}

for (let i = 0; i < 4; i++) bots.push(makeBot(i));

setTimeout(() => {
  console.log('超时退出：结算未在 300 秒内出现');
  process.exit(1);
}, 300000);
