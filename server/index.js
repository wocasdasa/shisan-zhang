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
    lastEvent: room.lastEvent || '',
    chat: (room.chat || []).slice(-10).map((c) => ({
      rel: rel(c.seat), kind: c.kind, text: c.text, ts: c.ts
    }))
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
      need: T.stage === 'return' ? (T.drawsDone[viewer] || 0) : 0,
      myTurnToDraw: T.stage === 'draw' && room.tribute && room.tribute.drawingSeat === viewer,
      canDraw: (T.plan.losers || []).map((s) => rel(s)),
      winnersRel: (T.plan.winners || []).map((s) => rel(s)),
      pairQuota: T.pairQuota || null,
      pulledFrom: T.drawnFrom || {}
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
    lastEvent: '',
    chat: [],
    chatLast: {}
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
  const key = newKey();
  const info = { conn, roomId: room.id, seat, name: String(name || '玩家').slice(0, 6), key };
  conns.set(conn.id, info);
  room.seats[seat] = {
    name: info.name, connId: conn.id, ready: false, ai: false, key, droppedAt: 0
  };
  setEvent(room, info.name + ' 加入房间');
  send(conn, { t: 'joined', room: room.id, seat, key });
  broadcast(room);
}

function newKey() {
  let s = '';
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  for (let i = 0; i < 8; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
  return s;
}

// 断线重连：带 key 回来找回原座位（对局中也能回）
function rejoinRoom(conn, msg) {
  const room = rooms.get(String(msg.room || '').trim());
  if (!room) { send(conn, { t: 'err', msg: '房间已解散' }); return; }
  const seat = room.seats.findIndex((s) => s && !s.ai && s.key && s.key === String(msg.key || ''));
  if (seat < 0) { send(conn, { t: 'err', msg: '座位已失效（超时被接管或已离桌）' }); return; }
  const info = { conn, roomId: room.id, seat, name: room.seats[seat].name, key: room.seats[seat].key };
  conns.set(conn.id, info);
  room.seats[seat].connId = conn.id;
  room.seats[seat].droppedAt = 0;
  setEvent(room, info.name + ' 回到房间');
  send(conn, { t: 'joined', room: room.id, seat, key: info.key, rejoin: true });
  broadcast(room);
}

// 掉线：对局中先保留座位 90 秒（期间轮到他由超时逻辑代打），超时转 AI
const DROP_GRACE_MS = 90000;

// 房主走了但还有人在线：把房主交给下一位真人；没有真人则清空 hostSeat
function ensureHost(room) {
  const cur = room.seats[room.hostSeat];
  if (cur && !cur.ai && cur.connId) return;
  for (let i = 1; i <= 4; i++) {
    const s = room.seats[(room.hostSeat + i) % 4];
    if (s && !s.ai && s.connId) { room.hostSeat = (room.hostSeat + i) % 4; return; }
  }
  room.hostSeat = -1;
}

function leaveRoom(conn, explicit) {
  const info = conns.get(conn.id);
  if (!info) return;
  const room = rooms.get(info.roomId);
  conns.delete(conn.id);
  if (!room) return;
  const seat = room.seats[info.seat];
  if (seat && room.phase !== 'wait') {
    if (!explicit && seat.key === info.key) {
      seat.connId = null;
      seat.droppedAt = Date.now();
      setEvent(room, seat.name + ' 掉线，座位保留 90 秒');
      broadcast(room);
      return;
    }
    // 对局中主动离开：座位交给机器人托管，只要还有人在线，房间不解散
    seat.connId = null;
    seat.droppedAt = 0;
    seat.ai = true;
    setEvent(room, seat.name + ' 离开，由机器人托管');
    if (humanCount(room) === 0) {
      clearTimer(room);
      rooms.delete(room.id);
      return;
    }
    ensureHost(room);
    broadcast(room);
    if (room.phase === 'play' && room.game && !room.game.over && room.game.turn === info.seat) {
      scheduleTurn(room);
    }
    return;
  }
  room.seats[info.seat] = null;
  setEvent(room, '有人离开房间');
  if (humanCount(room) === 0) {
    clearTimer(room);
    rooms.delete(room.id);
    return;
  }
  ensureHost(room);
  broadcast(room);
}

// 房主主动解散：通知所有人并销毁房间（只有这一种情况会解散）
function dissolveRoom(conn) {
  const info = conns.get(conn.id);
  if (!info) return false;
  const room = rooms.get(info.roomId);
  if (!room) return false;
  if (room.hostSeat !== info.seat) { send(conn, { t: 'err', msg: '只有房主能解散房间' }); return false; }
  clearTimer(room);
  rooms.delete(room.id);
  room.seats.forEach((s) => {
    if (!s || !s.connId) return;
    const c = conns.get(s.connId);
    if (c && c.conn) send(c.conn, { t: 'roomClosed', msg: '房主解散了房间' });
    conns.delete(s.connId);
  });
  return true;
}

// 宽限期到：掉线座位交给 AI 托管，后续轮次不再等 20 秒
setInterval(function () {
  rooms.forEach(function (room) {
    if (room.phase !== 'play' && room.phase !== 'tribute' && room.phase !== 'deal' && room.phase !== 'settle') return;
    let changed = false;
    room.seats.forEach(function (s) {
      if (!s || s.ai || s.connId) return;
      if (!s.droppedAt || Date.now() - s.droppedAt < DROP_GRACE_MS) return;
      s.ai = true;
      s.connId = null;
      setEvent(room, s.name + ' 超时未回，已由机器人托管');
      changed = true;
    });
    if (changed) {
      broadcast(room);
      if (room.phase === 'play' && room.game && !room.game.over) {
        const t = room.game.turn;
        if (room.seats[t] && room.seats[t].ai) scheduleTurn(room);
      }
    }
  });
}, 5000);


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
        pairQuota: plan.pairQuota || null,
        drawnFrom: {},   // 座位 → 已被抽走张数（只计成功抽走的，身份牌亮还不计）
        turnIdx: 0,      // 独食被抽方向逐家交错：当前轮到 winners 的第几位
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
// 独食被抽方向（pairQuota 非空且 losers.length===1，即三家每人抽独食 q 张）判定
function isLoneInterleave(T) {
  return !!(T && T.pairQuota && T.plan.losers && T.plan.losers.length === 1);
}

function advanceTribute(room) {
  const T = room.tribute;
  if (!T) return;
  // 独食被抽方向必须逐家交错（控制器裁决）：每位胜方 抽满配额→立即还贡→下一位，
  // 独食者恒持 ♠3/♠A 不可抽，"先全抽后统一还"牌池只有 11 张必然缺额
  if (isLoneInterleave(T)) { advanceInterleave(room); return; }
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
      aiTributeDraw(room, seat, cur.needFor(seat));
      advanceTribute(room);
    });
    return;
  }

  // 抽牌全部完成 → 还贡（还贡阶段 drawsDone = 尚未归还的张数）
  for (let i = 0; i < winners.length; i++) {
    const w = winners[i];
    if (room.seats[w] && room.seats[w].ai) {
      aiTributeReturn(room, w);
    }
  }
  const pendingReturn = winners.filter((w) => (T.drawsDone[w] || 0) > 0);
  if (pendingReturn.length) {
    T.stage = 'return';
    T.drawingSeat = -1;
    broadcast(room);
    armTributeTimer(room, () => {
      const cur = room.tribute;
      if (!cur || cur.stage !== 'return') return;
      cur.plan.winners.forEach((w) => {
        if (room.seats[w] && room.seats[w].ai) return;
        if ((cur.drawsDone[w] || 0) > 0) aiTributeReturn(room, w);
      });
      finishTribute(room);
    });
    return;
  }
  finishTribute(room);
}

// 独食被抽方向逐家交错：当前胜方抽满 q 张 → 立即向独食者还贡 q 张 → 推进下一位
function advanceInterleave(room) {
  const T = room.tribute;
  const winners = T.plan.winners;
  while (T.turnIdx < winners.length) {
    const idx = T.turnIdx;
    const w = winners[idx];
    if (T.drawsDone[w] === undefined) T.drawsDone[w] = 0;
    const isAI = room.seats[w] && room.seats[w].ai;
    if (T.stage !== 'return') {
      // 当前胜方的抽牌阶段（配额按每位胜方 drawsDone/shares 计）
      const need = T.needFor(w);
      if (need > 0) {
        if (isAI) { aiTributeDraw(room, w, need); continue; }
        T.drawingSeat = w;
        T.stage = 'draw';
        broadcast(room);
        armTributeTimer(room, () => {
          const cur = room.tribute;
          if (!cur || cur.stage !== 'draw') return;
          const seat = cur.drawingSeat;
          if (seat < 0) return;
          aiTributeDraw(room, seat, cur.needFor(seat));
          advanceTribute(room);
        });
        return;
      }
      T.stage = 'return';
    }
    // 当前胜方抽满 → 立即还贡（还给唯一败方=独食者，牌池回填后再推进下一位）
    if (isAI) {
      aiTributeReturn(room, w);
      T.turnIdx++;
      T.stage = 'draw';
      continue;
    }
    if ((T.drawsDone[w] || 0) > 0) {
      T.drawingSeat = -1;
      broadcast(room);
      armTributeTimer(room, () => {
        const cur = room.tribute;
        if (!cur || cur.stage !== 'return') return;
        aiTributeReturn(room, w);
        cur.turnIdx++;
        cur.stage = 'draw';
        advanceTribute(room);
      });
      return;
    }
    T.turnIdx++;
    T.stage = 'draw';
  }
  finishTribute(room);
}

function tributeDrawOne(room, winner, loser) {
  const T = room.tribute;
  const g = room.game;
  if (!T || !g) return false;
  // 每败方上限只挂独食抽牌方向（winners.length===1，多败方）；被抽方向
  // （losers.length===1）drawnFrom 是三家合计，配额按每位胜方 drawsDone/shares 计，
  // 此处若误拦会与逐家交错流程死锁（同单机 perLoserCap 裁决）
  const perLoserCap = !!(T.pairQuota && T.plan.winners && T.plan.winners.length === 1);
  if (perLoserCap && (T.drawnFrom[loser] || 0) >= T.pairQuota) return false;
  for (let guard = 0; guard < 40; guard++) {
    const hand = g.players[loser].hand;
    if (!hand.length) return false;
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
    T.drawnFrom[loser] = (T.drawnFrom[loser] || 0) + 1;
    T.log.push({ text: playerName(room, winner) + ' 从 ' + playerName(room, loser) + ' 抽到 ' + cardName(card), kind: 'draw' });
    return true;
  }
  return false;
}

function aiTributeDraw(room, winner, need) {
  const T = room.tribute;
  const idx = T.plan.winners.indexOf(winner);
  for (let k = 0; k < need; k++) {
    // 独食被抽方向（losers.length===1）：目标恒为唯一败方，配额按每位胜方
    // drawsDone/shares 计；其余方向从尚未被抽满 pairQuota 的败方中随机选
    let targets;
    if (T.pairQuota && T.plan.losers.length === 1) {
      targets = T.plan.losers;
    } else {
      targets = GX.Tribute.freeLosers(T.plan, T.drawnFrom);
      if (!targets.length) {
        // 兜底：13 张牌池理论充足不会走到这里；防死循环强制视为完成——
        // 把该胜方配额收缩到实际抽到的张数（needFor→0，还贡也不多还）
        T.shares[idx] = T.drawsDone[winner] || 0;
        return;
      }
    }
    if (!tributeDrawOne(room, winner, targets[Math.floor(Math.random() * targets.length)])) {
      // 理论不可达：抽不动时同样收缩配额强制完成（还贡按实际被抽记录进行）
      T.shares[idx] = T.drawsDone[winner] || 0;
      return;
    }
  }
}

// 该胜方下一笔未归还的被抽记录（还贡按笔还给原主人，与引擎 run() 一致）
function nextUnreturnedDraw(T, winner) {
  for (let i = 0; i < T.draws.length; i++) {
    const d = T.draws[i];
    if (d.to === winner && !d.returned) return d;
  }
  return null;
}

function aiTributeReturn(room, winner) {
  const g = room.game;
  const T = room.tribute;
  let d;
  while ((d = nextUnreturnedDraw(T, winner))) {
    const mine = g.players[winner].hand.slice()
      .filter((c) => !GX.Tribute.isIdentity(c))
      .sort((a, b) => GX.Rules.rankVal(a.r, room.cfg.rankOrder) - GX.Rules.rankVal(b.r, room.cfg.rankOrder));
    if (!mine.length) break;
    const give = mine[0];
    const i = g.players[winner].hand.findIndex((x) => x.r === give.r && x.s === give.s);
    if (i < 0) break;
    g.players[winner].hand.splice(i, 1);
    g.players[d.from].hand.push(give);
    d.returned = true;
    T.drawsDone[winner] = Math.max(0, (T.drawsDone[winner] || 0) - 1);
    T.log.push({ text: playerName(room, winner) + ' 还贡 ' + cardName(give) + ' 给 ' + playerName(room, d.from), kind: 'ret' });
  }
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
  if (msg.t === 'rejoin') { rejoinRoom(conn, msg); return; }
  if (msg.t === 'ping') { send(conn, { t: 'pong', time: Date.now() }); return; }

  const info = conns.get(conn.id);
  if (!info) { send(conn, { t: 'err', msg: '还没进房间' }); return; }
  const room = rooms.get(info.roomId);
  if (!room) { send(conn, { t: 'err', msg: '房间已解散' }); return; }
  const seat = info.seat;

  if (msg.t === 'leave') { leaveRoom(conn, true); return; }

  if (msg.t === 'dissolve') { dissolveRoom(conn); return; }

  if (DBG) console.log('[R' + room.round + '] 收到 ' + msg.t + ' seat=' + seat +
    (msg.cards ? ' 牌数=' + msg.cards.length : ''));

  if (msg.t === 'rename') {
    const old = playerName(room, seat);
    const nm = String(msg.name || '').replace(/\s+/g, ' ').trim().slice(0, 6);
    if (!nm || !room.seats[seat]) return;
    room.seats[seat].name = nm;
    if (nm !== old) setEvent(room, old + ' 改名为 ' + nm);
    broadcast(room);
    return;
  }

  if (msg.t === 'chat') {
    const kind = msg.kind === 'emoji' ? 'emoji' : 'text';
    const text = String(msg.text || '').replace(/\s+/g, ' ').trim()
      .slice(0, kind === 'emoji' ? 4 : 16);
    if (!text) return;
    const now = Date.now();
    room.chatLast = room.chatLast || {};
    if (now - (room.chatLast[seat] || 0) < 500) return; // 连点节流
    room.chatLast[seat] = now;
    room.chat = room.chat || [];
    room.chat.push({ seat, kind, text, ts: now });
    if (room.chat.length > 30) room.chat.splice(0, room.chat.length - 30);
    setEvent(room, playerName(room, seat) + (kind === 'emoji' ? ' ' : ': ') + text);
    broadcast(room);
    return;
  }

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
    // 每败方上限只适用独食抽牌方向（winners.length===1）；被抽方向配额按每位胜方计
    const perLoserCap = !!(T.pairQuota && T.plan.winners && T.plan.winners.length === 1);
    if (perLoserCap && GX.Tribute.freeLosers(T.plan, T.drawnFrom).indexOf(loser) < 0) {
      send(conn, { t: 'err', msg: '这家已抽满' });
      return;
    }
    tributeDrawOne(room, seat, loser);
    if (T.needFor(seat) > 0) { broadcast(room); return; }
    advanceTribute(room);
    return;
  }

  if (msg.t === 'return') {
    const T = room.tribute;
    if (!T || T.stage !== 'return') return;
    if (T.plan.winners.indexOf(seat) < 0) return;
    // 独食被抽方向逐家交错：只有当前轮次的胜方可还贡
    if (isLoneInterleave(T) && T.plan.winners[T.turnIdx] !== seat) return;
    const g = room.game;
    const cards = msg.cards || [];
    const need = T.drawsDone[seat] || 0;
    const picked = cards.filter((c, i, arr) =>
      arr.findIndex((x) => x.r === c.r && x.s === c.s) === i);
    if (picked.length !== need) { send(conn, { t: 'err', msg: '要还 ' + need + ' 张' }); return; }
    picked.forEach((c) => {
      const i = g.players[seat].hand.findIndex((x) => x.r === c.r && x.s === c.s);
      if (i < 0) return;
      const d = nextUnreturnedDraw(T, seat);
      if (!d) return;
      g.players[seat].hand.splice(i, 1);
      g.players[d.from].hand.push({ r: c.r, s: c.s });
      d.returned = true;
      T.drawsDone[seat] = Math.max(0, (T.drawsDone[seat] || 0) - 1);
      T.log.push({ text: playerName(room, seat) + ' 还贡 ' + cardName(c) + ' 给 ' + playerName(room, d.from), kind: 'ret' });
    });
    if ((T.drawsDone[seat] || 0) <= 0) {
      if (isLoneInterleave(T)) {
        T.turnIdx++;
        T.stage = 'draw';
        advanceTribute(room);
      } else {
        const remaining = T.plan.winners.filter((w) => (T.drawsDone[w] || 0) > 0);
        if (!remaining.length) finishTribute(room);
        else { T.stage = 'return'; broadcast(room); }
      }
    } else {
      broadcast(room);
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
