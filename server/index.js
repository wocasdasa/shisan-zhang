// 联机服务端：所有出牌/进贡/计分都在这里校验，客户端只负责画和点
const WS = require('./ws.js');
const GX = require('../engine/index.js');

const PORT = Number(process.env.PORT || 8787);
const TURN_MS = 20000;
const DEAL_MS = 2200;
const DBG = !!process.env.DEBUG;

const rooms = new Map();
const conns = new Map(); // connId -> { conn, roomId, seat, name }
const aiSeats = new Map(); // roomId -> Set(seat)

let roomSeq = 1000;

function newRoomId() {
  const id = String(roomSeq++);
  return id.slice(-4);
}

function send(conn, obj) { if (conn) conn.send(obj); }

function roomPlayers(room) {
  return room.seats.filter(Boolean);
}

function humanCount(room) {
  return room.seats.filter((s) => s && !s.ai).length;
}

function playerName(room, seat) {
  const s = room.seats[seat];
  return s ? (s.name || (s.ai ? '机器人' + (seat + 1) : '空位')) : '空位';
}

function broadcast(room) {
  room.seats.forEach((s, seat) => {
    if (!s || s.ai || !s.connId) return;
    const c = conns.get(s.connId);
    if (c) send(c.conn, viewFor(room, seat));
  });
}

function viewFor(room, viewer) {
  const g = room.game;
  const rel = (s) => (s - viewer + 4) % 4;

  const seats = [0, 1, 2, 3].map((r) => {
    const seat = (viewer + r) % 4;
    const p = room.seats[seat];
    const gp = g ? g.players[seat] : null;
    return {
      name: playerName(room, seat),
      ai: !!(p && p.ai),
      ready: !!(p && p.ready),
      isYou: r === 0,
      count: gp ? gp.hand.length : 0,
      revealedCards: gp ? (gp.revealedCards || []) : [],
      score: room.scores[seat] || 0,
      online: !!(p && p.connId)
    };
  });

  const view = {
    t: 'state',
    room: room.id,
    phase: room.phase,
    round: room.round,
    rounds: room.rounds,
    seats,
    youSeatRel: 0,
    hand: g ? g.players[viewer].hand.slice() : [],
    trickPlays: g ? (g.trickPlays || []).map((pl) => ({
      player: rel(pl.player), cards: pl.cards, combo: pl.combo
    })) : [],
    turn: g && !g.over ? rel(g.turn) : -1,
    combo: g ? g.combo : null,
    firstPlayPending: g ? !!g.firstPlayPending : false,
    over: g ? !!g.over : false,
    deadline: room.deadline || 0,
    host: room.hostSeat === viewer,
    canStart: room.phase === 'wait' && room.hostSeat === viewer && humanCount(room) >= 1,
    lastEvent: room.lastEvent || ''
  };

  if (room.summary) view.summary = { scores: [0, 1, 2, 3].map((r) => room.scores[(viewer + r) % 4]) };

  if (room.tribute) {
    const T = room.tribute;
    view.tribute = {
      stage: T.stage,
      count: T.plan.count,
      winnerRanks: (T.plan.winnerRanks || []).map((x) => x),
      draws: T.draws.map((d) => ({ from: rel(d.from), card: d.card })),
      reveals: T.reveals.map((v) => ({ owner: rel(v.owner), card: v.card })),
      log: T.log.slice(-6),
      need: T.stage === 'return' ? T.needFor(viewer) : 0,
      myTurnToDraw: T.stage === 'draw' && room.tribute && room.tribute.drawingSeat === viewer,
      canDraw: (T.plan.losers || []).map((s) => rel(s)),
      winnersRel: (T.plan.winners || []).map((s) => rel(s))
    };
  }

  if (room.lastResult) {
    const R = room.lastResult;
    view.lastResult = {
      mode: R.camp.mode,
      loneRel: R.camp.mode === 'lone' ? rel(R.camp.lone) : -1,
      ranks: R.ranks.map((s) => rel(s)),
      scores: R.ranks.map((s) => R.scores[s]),
      winRanks: R.winRanks || [],
      teamA: (R.camp.teamA || []).map((s) => rel(s)),
      teamB: (R.camp.teamB || []).map((s) => rel(s))
    };
  }

  return view;
}

function setEvent(room, text) { room.lastEvent = text; }

// ---------- 房间 ----------
function createRoom(conn, msg) {
  const id = newRoomId();
  const room = {
    id,
    hostSeat: 0,
    seats: new Array(4).fill(null),
    rounds: [8, 12, 16, 24, 32].indexOf(msg.rounds) >= 0 ? msg.rounds : 8,
    cfg: GX.Rules.resolve(),
    phase: 'wait',
    round: 0,
    scores: [0, 0, 0, 0],
    game: null,
    lastResult: null,
    tribute: null,
    summary: false,
    deadline: 0,
    timer: null,
    lastEvent: ''
  };
  rooms.set(id, room);
  onJoin(conn, room, msg.name, 0);
  return room;
}

function joinRoom(conn, msg) {
  const room = rooms.get(String(msg.room || '').trim());
  if (!room) { send(conn, { t: 'err', msg: '房间不存在' }); return; }
  if (room.phase !== 'wait') { send(conn, { t: 'err', msg: '这局已经开始了' }); return; }
  const seat = room.seats.findIndex((s) => !s);
  if (seat < 0) { send(conn, { t: 'err', msg: '房间满了' }); return; }
  onJoin(conn, room, msg.name, seat);
}

function onJoin(conn, room, name, seat) {
  const info = { conn, roomId: room.id, seat, name: String(name || '玩家').slice(0, 6) };
  conns.set(conn.id, info);
  room.seats[seat] = { name: info.name, connId: conn.id, ready: false, ai: false };
  setEvent(room, info.name + ' 加入房间');
  send(conn, { t: 'joined', room: room.id, seat });
  broadcast(room);
}

function leaveRoom(conn) {
  const info = conns.get(conn.id);
  if (!info) return;
  const room = rooms.get(info.roomId);
  conns.delete(conn.id);
  if (!room) return;
  room.seats[info.seat] = null;
  setEvent(room, '有人离开房间');
  if (room.phase === 'wait') {
    if (humanCount(room) === 0) rooms.delete(room.id);
  }
  broadcast(room);
}

// ---------- 开局 ----------
function startRoom(room) {
  room.seats = room.seats.map((s, i) => (s ? s : { name: '机器人' + (i + 1), ai: true, ready: true }));
  room.round = 0;
  room.scores = [0, 0, 0, 0];
  room.lastResult = null;
  room.summary = false;
  newRound(room);
}

function newRound(room) {
  clearTimer(room);
  room.round++;
  room.phase = 'deal';
  room.tribute = null;
  room.game = GX.Table.createRound({ seed: Math.floor(Math.random() * 4e9), config: room.cfg });
  room.deadline = Date.now() + DEAL_MS;
  broadcast(room);
  room.timer = setTimeout(function () { afterDeal(room); }, DEAL_MS);
}

function afterDeal(room) {
  clearTimer(room);
  room.deadline = 0;
  if (room.round >= 2 && room.cfg.tributeEnabled && room.lastResult) {
    const plan = GX.Tribute.plan(room.lastResult, room.cfg);
    if (!plan.skip && plan.count > 0) {
      room.tribute = {
        plan: plan,
        draws: [],
        reveals: [],
        log: [],
        shares: GX.Tribute.distribute(plan.count, plan.winners.length),
        stage: 'draw',
        drawingSeat: -1,
        drawsDone: {},
        needFor: function (seat) {
          const idx = this.plan.winners.indexOf(seat);
          if (idx < 0) return 0;
          return Math.max(0, this.shares[idx] - (this.drawsDone[seat] || 0));
        }
      };
      room.phase = 'tribute';
      advanceTribute(room);
      return;
    }
  }
  startPlay(room);
}

function startPlay(room) {
  room.phase = 'play';
  room.tribute = null;
  broadcast(room);
  scheduleTurn(room);
}

function startPlayAfterTribute(room, leadSeat) {
  if (leadSeat !== undefined && leadSeat !== null && leadSeat >= 0) {
    room.game.turn = leadSeat;
    room.game.firstPlayPending = false;
  }
  startPlay(room);
}

// ---------- 进贡 ----------
function advanceTribute(room) {
  const T = room.tribute;
  if (!T) return;
  const winners = T.plan.winners;

  for (let i = 0; i < winners.length; i++) {
    const w = winners[i];
    if (T.drawsDone[w] === undefined) T.drawsDone[w] = 0;
    const need = T.needFor(w);
    if (need <= 0) continue;
    const isAI = room.seats[w] && room.seats[w].ai;
    if (isAI) {
      aiTributeDraw(room, w, need);
      continue;
    }
    // 轮到人类胜方抽牌
    T.drawingSeat = w;
    T.stage = 'draw';
    broadcast(room);
    armTributeTimer(room, () => {
      const cur = room.tribute;
      if (!cur || cur.stage !== 'draw') return;
      const seat = cur.drawingSeat;
      if (seat < 0) return;
      let guard = 0;
      while (cur.needFor(seat) > 0 && guard++ < 8) {
        const losers = cur.plan.losers || [];
        if (!losers.length) break;
        tributeDrawOne(room, seat, losers[Math.floor(Math.random() * losers.length)]);
      }
      advanceTribute(room);
    });
    return;
  }

  // 抽牌全部完成 → 还贡
  for (let i = 0; i < winners.length; i++) {
    const w = winners[i];
    if (room.seats[w] && room.seats[w].ai) {
      aiTributeReturn(room, w);
    }
  }
  const humanWinners = winners.filter((w) => !(room.seats[w] && room.seats[w].ai));
  const pendingReturn = humanWinners.filter((w) => T.needFor(w) > 0);
  if (pendingReturn.length) {
    T.stage = 'return';
    T.drawingSeat = -1;
    broadcast(room);
    armTributeTimer(room, () => {
      const cur = room.tribute;
      if (!cur || cur.stage !== 'return') return;
      cur.plan.winners.forEach((w) => {
        if (room.seats[w] && room.seats[w].ai) return;
        if (cur.needFor(w) > 0) aiTributeReturn(room, w);
      });
      finishTribute(room);
    });
    return;
  }
  finishTribute(room);
}

function tributeDrawOne(room, winner, loser) {
  const T = room.tribute;
  const g = room.game;
  if (!T || !g) return;
  for (let guard = 0; guard < 40; guard++) {
    const hand = g.players[loser].hand;
    if (!hand.length) return;
    const idx = Math.floor(Math.random() * hand.length);
    const card = hand[idx];
    if (GX.Tribute.isIdentity(card)) {
      T.reveals.push({ owner: loser, card });
      g.players[loser].revealed = true;
      g.players[loser].revealedCards = (g.players[loser].revealedCards || []).concat([card.r]);
      T.log.push({ text: playerName(room, loser) + ' 的 ' + cardName(card) + ' 是身份牌，亮出归还后重抽', kind: 'warn' });
      continue;
    }
    hand.splice(idx, 1);
    g.players[winner].hand.push(card);
    T.draws.push({ from: loser, to: winner, card });
    T.drawsDone[winner] = (T.drawsDone[winner] || 0) + 1;
    T.log.push({ text: playerName(room, winner) + ' 从 ' + playerName(room, loser) + ' 抽到 ' + cardName(card), kind: 'draw' });
    return;
  }
}

function aiTributeDraw(room, winner, need) {
  const T = room.tribute;
  for (let k = 0; k < need; k++) {
    const losers = T.plan.losers;
    tributeDrawOne(room, winner, losers[Math.floor(Math.random() * losers.length)]);
  }
}

function aiTributeReturn(room, winner) {
  const g = room.game;
  const T = room.tribute;
  const mine = g.players[winner].hand.slice()
    .filter((c) => !GX.Tribute.isIdentity(c))
    .sort((a, b) => GX.Rules.rankVal(a.r, room.cfg.rankOrder) - GX.Rules.rankVal(b.r, room.cfg.rankOrder));
  const toGive = mine.slice(0, T.needFor(winner));
  const loser = T.plan.losers[0];
  toGive.forEach((card) => {
    const i = g.players[winner].hand.findIndex((x) => x.r === card.r && x.s === card.s);
    if (i < 0) return;
    g.players[winner].hand.splice(i, 1);
    g.players[loser].hand.push(card);
    T.drawsDone[winner] = Math.max(0, (T.drawsDone[winner] || 0) - 1);
    T.log.push({ text: playerName(room, winner) + ' 还贡 ' + cardName(card) + ' 给 ' + playerName(room, loser), kind: 'ret' });
  });
}

function finishTribute(room) {
  const T = room.tribute;
  const g = room.game;
  let lead = -1;
  if (room.cfg.tributeFirstLead === 'maxCardOwner' && T && T.draws.length) {
    let best = null;
    T.draws.forEach((d) => {
      if (!best) { best = d; return; }
      if (GX.Hand.compare(GX.Hand.parse([d.card], room.cfg), GX.Hand.parse([best.card], room.cfg)) > 0) best = d;
    });
    lead = best.from;
  }
  room.tribute = null;
  startPlayAfterTribute(room, lead);
}

function cardName(c) {
  const S = ['♦', '♣', '♥', '♠'];
  const R = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  return S[c.s] + (R[c.r] || c.r);
}

// ---------- 出牌 ----------
function clearTimer(room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
}

function armTributeTimer(room, fn) {
  clearTimer(room);
  room.deadline = Date.now() + TURN_MS;
  room.timer = setTimeout(fn, TURN_MS);
}

function scheduleTurn(room) {
  clearTimer(room);
  const g = room.game;
  if (!g || g.over || room.phase !== 'play') return;
  const seat = g.turn;
  const isAI = room.seats[seat] && room.seats[seat].ai;
  if (DBG) console.log('[R' + room.round + '] 轮到 seat ' + seat + (isAI ? '(AI)' : '(人)') +
    ' 桌面' + (g.combo ? '有牌' : '为空') + ' 手牌数' + g.players.map((p) => p.hand.length).join('/'));
  if (isAI) {
    room.timer = setTimeout(() => aiAct(room, seat), 780);
    room.deadline = 0;
  } else {
    room.deadline = Date.now() + TURN_MS;
    room.timer = setTimeout(() => humanTimeout(room, seat), TURN_MS);
  }
  broadcast(room);
}

function aiAct(room, seat) {
  clearTimer(room);
  const g = room.game;
  if (!g || g.over || room.phase !== 'play' || g.turn !== seat) return;
  const action = GX.AI2.decide(g, seat, 1);
  if (action.type === 'play') {
    GX.Table.play(g, seat, action.cards);
  } else if (GX.Table.pass(g, seat)) {
    const ok = GX.Moves.candidates(g.players[seat].hand, room.cfg)
      .filter((c) => GX.Table.validate(g, seat, c.cards) === null);
    if (ok.length) GX.Table.play(g, seat, GX.Moves.lowest(ok).cards);
  }
  afterAction(room);
}

function humanTimeout(room, seat) {
  const g = room.game;
  if (!g || g.over || g.turn !== seat) return;
  if (g.combo && GX.Table.pass(g, seat) === null) {
    setEvent(room, playerName(room, seat) + ' 超时，自动过牌');
  } else {
    const ok = GX.Moves.candidates(g.players[seat].hand, room.cfg)
      .filter((c) => GX.Table.validate(g, seat, c.cards) === null);
    if (ok.length) GX.Table.play(g, seat, GX.Moves.lowest(ok).cards);
    setEvent(room, playerName(room, seat) + ' 超时，自动出最小牌');
  }
  afterAction(room);
}

function afterAction(room) {
  const g = room.game;
  if (g && g.over) {
    settleRound(room);
    return;
  }
  scheduleTurn(room);
}

function settleRound(room) {
  clearTimer(room);
  const res = GX.Settle.settle(room.game);
  room.lastResult = res;
  res.scores.forEach((v, i) => { room.scores[i] += v; });
  room.phase = 'settle';
  room.deadline = 0;
  setEvent(room, '本局结束');
  broadcast(room);
}

function nextRound(room) {
  if (room.round >= room.rounds) {
    room.phase = 'summary';
    room.summary = true;
    broadcast(room);
    return;
  }
  newRound(room);
}

// ---------- 消息分发 ----------
function handle(conn, msg) {
  if (!msg || !msg.t) return;
  if (msg.t === 'create') { createRoom(conn, msg); return; }
  if (msg.t === 'join') { joinRoom(conn, msg); return; }
  if (msg.t === 'ping') { send(conn, { t: 'pong', time: Date.now() }); return; }

  const info = conns.get(conn.id);
  if (!info) { send(conn, { t: 'err', msg: '还没进房间' }); return; }
  const room = rooms.get(info.roomId);
  if (!room) { send(conn, { t: 'err', msg: '房间已解散' }); return; }
  const seat = info.seat;

  if (DBG) console.log('[R' + room.round + '] 收到 ' + msg.t + ' seat=' + seat +
    (msg.cards ? ' 牌数=' + msg.cards.length : ''));

  if (msg.t === 'ready') {
    if (room.phase !== 'wait' || !room.seats[seat]) return;
    room.seats[seat].ready = msg.v !== false;
    broadcast(room);
    return;
  }

  if (msg.t === 'start') {
    if (room.hostSeat !== seat) { send(conn, { t: 'err', msg: '只有房主能开始' }); return; }
    if (room.phase !== 'wait') return;
    startRoom(room);
    return;
  }

  if (msg.t === 'play') {
    if (room.phase !== 'play') return;
    const g = room.game;
    if (!g || g.over || g.turn !== seat) { send(conn, { t: 'err', msg: '还没轮到你' }); return; }
    const cards = (msg.cards || []).map((c) => ({ r: c.r, s: c.s }));
    if (!cards.length) return;
    const err = GX.Table.validate(g, seat, cards);
    if (err) { send(conn, { t: 'err', msg: errText(err) }); return; }
    GX.Table.play(g, seat, cards);
    setEvent(room, playerName(room, seat) + ' 出牌');
    afterAction(room);
    return;
  }

  if (msg.t === 'pass') {
    if (room.phase !== 'play') return;
    const g = room.game;
    if (!g || g.over || g.turn !== seat) return;
    const err = GX.Table.pass(g, seat);
    if (err) { send(conn, { t: 'err', msg: errText(err) }); return; }
    setEvent(room, playerName(room, seat) + ' 过牌');
    afterAction(room);
    return;
  }

  if (msg.t === 'next') {
    if (room.phase !== 'settle') return;
    if (room.hostSeat !== seat) { send(conn, { t: 'err', msg: '等房主开下一局' }); return; }
    nextRound(room);
    return;
  }

  if (msg.t === 'draw') {
    const T = room.tribute;
    if (!T || T.stage !== 'draw' || T.drawingSeat !== seat) return;
    const relLoser = Number(msg.seatRel);
    const loser = (seat + relLoser) % 4;
    if (T.plan.losers.indexOf(loser) < 0) { send(conn, { t: 'err', msg: '只能抽败方的牌' }); return; }
    tributeDrawOne(room, seat, loser);
    if (T.needFor(seat) > 0) { broadcast(room); return; }
    advanceTribute(room);
    return;
  }

  if (msg.t === 'return') {
    const T = room.tribute;
    if (!T || T.stage !== 'return') return;
    if (T.plan.winners.indexOf(seat) < 0) return;
    const g = room.game;
    const cards = msg.cards || [];
    const need = T.needFor(seat);
    const picked = cards.filter((c, i, arr) =>
      arr.findIndex((x) => x.r === c.r && x.s === c.s) === i);
    if (picked.length !== need) { send(conn, { t: 'err', msg: '要还 ' + need + ' 张' }); return; }
    const target = T.plan.losers[0];
    picked.forEach((c) => {
      const i = g.players[seat].hand.findIndex((x) => x.r === c.r && x.s === c.s);
      if (i < 0) return;
      g.players[seat].hand.splice(i, 1);
      g.players[target].hand.push({ r: c.r, s: c.s });
      T.drawsDone[seat] = Math.max(0, (T.drawsDone[seat] || 0) - 1);
      T.log.push({ text: playerName(room, seat) + ' 还贡 ' + cardName(c) + ' 给 ' + playerName(room, target), kind: 'ret' });
    });
    if (T.needFor(seat) <= 0) {
      const remaining = T.plan.winners.filter((w) => !(room.seats[w] && room.seats[w].ai));
      const done = remaining.filter((w) => T.needFor(w) > 0);
      if (!done.length) finishTribute(room);
      else { T.stage = 'return'; broadcast(room); }
    }
    return;
  }
}

function errText(code) {
  const map = {
    'not-turn': '还没轮到你',
    'already-passed': '本轮已过牌',
    'not-same-count': '张数必须和桌面一样',
    'not-bigger': '压不过桌面这手',
    'first-must-d4': '第一手必须含 ♦4',
    'bad-combo': '不是合法牌型',
    'finished': '你已经出完了'
  };
  return map[code] || '出牌不合法';
}

WS.createServer(PORT, (conn) => {
  conn.on('message', (msg) => handle(conn, msg));
  conn.on('close', () => leaveRoom(conn));
  send(conn, { t: 'hello', server: 'guangxi13', turnMs: TURN_MS });
});

console.log('十三张独食 · 联机服务端已启动  ws://0.0.0.0:' + PORT);
