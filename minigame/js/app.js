// 游戏逻辑 + 触屏交互：微信小游戏与浏览器预览共用
(function () {
  var P = require('./platform.js');
  var V = require('./views.js');
  var SFX = require('./audio.js');
  var GX = require('./engine/index.js');
  var NET = require('./net.js');

  var SEAT_NAMES = ['你', '西家', '北家', '东家'];
  var SUIT = ['♦', '♣', '♥', '♠'];
  var RANK_TXT = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  var TURN_SECONDS = 20;

  var S = {
    cfg: GX.Rules.resolve(),
    rounds: 8,
    roomCfg: { tributeTier: 'heavy', turnSeconds: 20, teamHint: 'none', testTribute: false },
    round: 0,
    scores: [0, 0, 0, 0],
    game: null,
    lastResult: null,
    phase: 'idle',
    selected: [],
    hint: '',
    tribute: null,
    busy: false,
    level: 1,
    timer: { id: null, left: 0 },
    toast: '',
    summary: false,
    resetPending: 0,
    hits: [],
    deal: null,
    fx: {},
    audioOn: true,
    // 联机
    mode: 'solo',
    lobby: null,
    waitRoom: false,
    room: '',
    isHost: false,
    myReady: false,
    seats: [],
    netStatus: '',
    netView: null,
    prevPlays: 0
  };

  var toastTimer = null;
  // 仅浏览器预览支持 ?auto=1：南家也交给 AI，用来自测整局流程
  var AUTO = (typeof window !== 'undefined') && window.location &&
    /auto=1/.test(window.location.search || '');

  function rankText(r) { return RANK_TXT[r] || String(r); }
  function suitRank(c) { return SUIT[c.s] + rankText(c.r); }
  function sameCard(a, b) { return a.r === b.r && a.s === b.s; }

  function toast(msg) {
    S.toast = msg;
    P.markDirty();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { S.toast = ''; P.markDirty(); }, 1600);
  }

  function draw() {
    S.hits = V.draw(P.ctx(), S, P.h(), P.w());
    // 动画期间持续重绘（脏标记 + rAF 循环）
    var now = Date.now();
    if (S.deal ||
      (S.fx.playT0 && now - S.fx.playT0 < 320) ||
      (S.fx.shockT0 && now - S.fx.shockT0 < 440) ||
      (S.fx.drawT0 && now - S.fx.drawT0 < 400) ||
      (S.fx.retT0 && now - S.fx.retT0 < 360) ||
      (S.fx.seatPlay && now - S.fx.seatPlay.t0 < 470) ||
      (S.fx.settleT0 && now - S.fx.settleT0 < 1020)) P.markDirty();
  }

  // ---------- 计时 ----------
  function clearTurnTimer() {
    if (S.timer.id) { clearInterval(S.timer.id); S.timer.id = null; }
    S.timer.left = 0;
    P.markDirty();
  }

  function startTurnTimer() {
    clearTurnTimer();
    if (S.phase !== 'play' || !S.game || S.game.over || S.game.turn !== 0 || S.busy || AUTO) return;
    // 本局第一手（还没人出过牌）给双倍时间
    var firstTurn = !S.game || S.game.lastPlayer === undefined || S.game.lastPlayer < 0;
    var baseSec = (S.cfg && S.cfg.turnSeconds) || TURN_SECONDS;
    S.timer.left = firstTurn ? baseSec * 2 : baseSec;
    SFX.play('turn');
    S.timer.id = setInterval(function () {
      S.timer.left--;
      if (S.timer.left > 0 && S.timer.left <= 5) SFX.play('tick');
      if (S.timer.left <= 0) {
        clearTurnTimer();
        onTimeout();
        return;
      }
      P.markDirty();
    }, 1000);
    P.markDirty();
  }

  function onTimeout() {
    var g = S.game;
    if (!g || g.over || S.phase !== 'play' || g.turn !== 0) return;
    S.selected = [];
    // 超时只做"跳过"；只有起手（桌面无牌、必须出牌）才替出最小合法牌
    if (g.combo && GX.Table.pass(g, 0) === null) {
      S.hint = '超时：自动跳过（过牌）';
      SFX.play('pass');
      P.markDirty();
      scheduleAI();
      return;
    }
    var cands = GX.Moves.candidates(g.players[0].hand, S.cfg);
    var ok = cands.filter(function (c) { return GX.Table.validate(g, 0, c.cards) === null; });
    if (ok.length) {
      GX.Table.play(g, 0, GX.Moves.lowest(ok).cards);
      S.hint = '超时：起手必须出牌，已出最小牌';
      fxPlayed(g, 0);
      P.markDirty();
      maybeFinishRound();
      scheduleAI();
      return;
    }
    S.hint = '超时';
    P.markDirty();
  }

  // ---------- 出牌 ----------
  function tapCard(i) {
    if (S.phase !== 'play' && S.phase !== 'tribute') return;
    var hand = S.game.players[0].hand;
    var c = hand[i];
    if (!c) return;
    var idx = S.selected.findIndex(function (s) { return sameCard(s, c); });
    if (idx >= 0) S.selected.splice(idx, 1);
    else S.selected.push(c);
    S.hint = '';
    SFX.play('select');
    P.markDirty();
  }

  function doPlay() {
    if (S.mode === 'online') {
      if (!S.game) return;
      if (S.game.turn !== 0) { S.hint = '还没轮到你'; P.markDirty(); return; }
      var onCards = S.selected.slice();
      if (!onCards.length) { S.hint = '先选牌'; P.markDirty(); return; }
      NET.send({ t: 'play', cards: onCards });
      S.selected = [];
      S.hint = '';
      P.markDirty();
      return;
    }
    var g = S.game;
    var cards = S.selected.slice();
    if (!cards.length) { S.hint = '先选牌'; P.markDirty(); return; }
    var err = GX.Table.validate(g, 0, cards);
    if (err) { S.hint = explain(err); P.markDirty(); return; }
    GX.Table.play(g, 0, cards);
    S.selected = [];
    S.hint = '';
    fxPlayed(g, 0);
    P.markDirty();
    maybeFinishRound();
    scheduleAI();
  }

  function doPass() {
    if (S.mode === 'online') {
      NET.send({ t: 'pass' });
      S.selected = [];
      P.markDirty();
      return;
    }
    var err = GX.Table.pass(S.game, 0);
    if (err) { S.hint = explain(err); P.markDirty(); return; }
    S.selected = [];
    SFX.play('pass');
    P.markDirty();
    scheduleAI();
  }

  function doHint() {
    var g = S.game;
    if (!g || g.turn !== 0) return;
    if (S.mode === 'online') {
      var cs = GX.Moves.candidates(g.players[0].hand, S.cfg);
      if (g.combo) {
        cs = cs.filter(function (c) { return GX.Hand.compare(c.combo, g.combo) > 0; });
      }
      if (g.firstPlayPending) {
        cs = cs.filter(function (c) {
          return c.cards.some(function (x) { return x.r === 4 && x.s === 0; });
        });
      }
      var pick2 = GX.Moves.lowest(cs);
      if (!pick2) { S.hint = g.combo ? '这手压不过，只能过牌' : '没有合法牌型'; P.markDirty(); return; }
      S.selected = pick2.cards.slice();
      S.hint = '提示：' + GX.Hand.kindLabel(pick2.combo.kind);
      P.markDirty();
      return;
    }
    var cands = GX.Moves.candidates(g.players[0].hand, S.cfg);
    var ok = cands.filter(function (c) { return GX.Table.validate(g, 0, c.cards) === null; });
    if (!ok.length) { S.hint = g.combo ? '这手压不过，只能过牌' : '没有合法牌型'; P.markDirty(); return; }
    var pick = g.combo
      ? GX.Moves.lowest(ok.filter(function (c) { return GX.Hand.compare(c.combo, g.combo) > 0; }))
      : GX.Moves.lowest(ok);
    if (!pick) { S.hint = '压不过'; P.markDirty(); return; }
    S.selected = pick.cards.slice();
    S.hint = '提示：' + GX.Hand.kindLabel(pick.combo.kind);
    P.markDirty();
  }

  function explain(code) {
    var map = {
      'not-turn': '还没轮到你',
      'over': '本局已结束',
      'already-passed': '本轮已过牌，不能再出',
      'not-same-count': '张数必须和桌面一样',
      'not-bigger': '压不过桌面这手',
      'first-must-d4': '第一手必须包含 ♦4',
      'bad-combo': '不是合法牌型',
      'finished': '你已经出完了'
    };
    return map[code] || '出牌不合法';
  }

  // ---------- AI ----------
  // 出牌瞬间：按牌型触发不同特效/音效
  function fxPlayed(g, seat) {
    var plays = (g && g.trickPlays) || [];
    var last = plays.length ? plays[plays.length - 1] : null;
    var k = (last && last.combo && last.combo.kind) || 'single';
    SFX.play('play');
    S.fx.playT0 = Date.now();
    S.fx.shockT0 = Date.now();
    S.fx.kind = k;
    SFX.play('shock');
    SFX.playKind(k);
    S.fx.seatPlay = { p: seat, t0: Date.now() };
  }

  function scheduleAI() {
    if (!S.game || S.game.over || S.phase !== 'play') { clearTurnTimer(); return; }
    if (S.game.turn === 0 && !AUTO) { startTurnTimer(); P.markDirty(); return; }
    clearTurnTimer();
    S.busy = true;
    P.markDirty();
    setTimeout(function () {
      if (!S.game || S.game.over) { S.busy = false; P.markDirty(); return; }
      var p = S.game.turn;
      var action = S.level === 0 ? GX.AI.decide(S.game, p) : GX.AI2.decide(S.game, p, S.level);
      if (action.type === 'play') {
        GX.Table.play(S.game, p, action.cards);
        SFX.play('play');
        S.hint = '';
        S.fx.playT0 = Date.now();
        S.fx.shockT0 = Date.now();
        SFX.play('shock');
        S.fx.seatPlay = { p: p, t0: Date.now() };
      } else if (GX.Table.pass(S.game, p)) {
        var cands = GX.Moves.candidates(S.game.players[p].hand, S.cfg);
        var ok = cands.filter(function (c) { return GX.Table.validate(S.game, p, c.cards) === null; });
        if (ok.length) {
          GX.Table.play(S.game, p, GX.Moves.lowest(ok).cards);
          fxPlayed(S.game, p);
        } else {
          SFX.play('pass');
        }
      }
      S.busy = false;
      P.markDirty();
      if (S.game.over) { maybeFinishRound(); return; }
      scheduleAI();
    }, 620);
  }

  function maybeFinishRound() {
    if (!S.game || !S.game.over) return;
    clearTurnTimer();
    var res = GX.Settle.settle(S.game);
    S.lastResult = res;
    res.scores.forEach(function (v, i) { S.scores[i] += v; });
    S.phase = 'settle';
    S.deal = null;
    S.fx.settleT0 = Date.now();
    SFX.play(res.scores[0] > 0 ? 'win' : res.scores[0] < 0 ? 'lose' : 'pass');
    P.markDirty();
    if (AUTO) setTimeout(function () { onNext(); }, 900);
  }

  // ---------- 联机 ----------
  var netBound = false;

  function myName() {
    if (typeof window !== 'undefined' && window.location) {
      var q = /(?:\?|&)name=([^&]+)/.exec(window.location.search || '');
      if (q) return decodeURIComponent(q[1]).slice(0, 6);
    }
    return '玩家';
  }

  function bindNet() {
    if (netBound) return;
    netBound = true;
    NET.on('open', function () {
      S.netStatus = '已连接';
      if (S.pending) { var pj = S.pending; S.pending = null; NET.send(pj); }
      if (S.lobby) S.lobby.err = '';
      toast('已连接服务器');
      P.markDirty();
    });
    NET.on('close', function () {
      S.netStatus = '连接断开';
      toast('连接断开');
      P.markDirty();
    });
    NET.on('error', function () {
      S.netStatus = '连接失败';
      if (S.lobby) S.lobby.err = '连不上服务器：' + NET.defaultUrl();
      P.markDirty();
    });
    NET.on('message', onNetMessage);
  }

  function netJoinServer() {
    bindNet();
    if (S.netStatus === '已连接') return true;
    S.netStatus = '连接中…';
    NET.connect();
    return false;
  }

  function openLobby() {
    S.mode = 'online';
    S.waitRoom = false;
    S.lobby = { kind: 'entry', url: NET.defaultUrl(), err: '', code: '' };
    S.phase = 'lobby';
    bindNet();
    P.markDirty();
  }

  function backToSolo() {
    if (S.mode === 'online') { NET.send({ t: 'leave' }); NET.close(); }
    S.mode = 'solo';
    S.lobby = null;
    S.waitRoom = false;
    S.netView = null;
    S.room = '';
    S.isHost = false;
    S.myReady = false;
    S.seats = [];
    S.game = null;
    S.phase = 'menu';
    P.markDirty();
  }

  function netCreate() {
    var ready = netJoinServer();
    var msg = { t: 'create', name: myName(), rounds: S.rounds, cfg: S.roomCfg };
    if (ready) NET.send(msg); else S.pending = msg;
    S.lobby.err = '正在连接…';
    P.markDirty();
  }

  function netJoin(code) {
    if (!code || code.length !== 4) { S.lobby.err = '房间号是 4 位数字'; P.markDirty(); return; }
    var ready = netJoinServer();
    var msg = { t: 'join', name: myName(), room: code };
    if (ready) NET.send(msg); else S.pending = msg;
    S.lobby.err = '正在连接…';
    P.markDirty();
  }

  function onNetMessage(m) {
    if (m.t === 'joined') {
      S.room = m.room;
      S.lobby = null;
      toast('已进入房间 ' + m.room);
      P.markDirty();
      return;
    }
    if (m.t === 'err') {
      if (S.lobby) S.lobby.err = m.msg;
      else toast(m.msg);
      P.markDirty();
      return;
    }
    if (m.t === 'state') { applyView(m); return; }
  }

  function startNetTimer(deadline) {
    clearTurnTimer();
    function tick() {
      var left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      S.timer.left = left;
      P.markDirty();
      if (left <= 0) clearTurnTimer();
    }
    tick();
    S.timer.id = setInterval(tick, 500);
  }

  function applyView(v) {
    bindNet();
    S.mode = 'online';
    S.netView = v;
    S.netStatus = '在线';
    S.room = v.room;
    S.round = v.round;
    S.rounds = v.rounds;
    if (v.cfg) S.roomCfg = v.cfg;
    S.isHost = !!v.host;
    S.seats = v.seats || [];
    S.myReady = !!(S.seats[0] && S.seats[0].ready);
    S.scores = S.seats.map(function (s) { return s.score || 0; });
    S.waitRoom = v.phase === 'wait';
    S.summary = v.phase === 'summary';

    var players = S.seats.map(function (s, i) {
      return {
        hand: i === 0 ? sortHand(v.hand || []) : new Array(s.count || 0),
        revealedCards: s.revealedCards || []
      };
    });

    if (v.phase === 'wait' || v.phase === 'summary') {
      S.game = null;
    } else {
      S.game = {
        players: players,
        trickPlays: v.trickPlays || [],
        turn: v.turn,
        combo: v.combo,
        firstPlayPending: !!v.firstPlayPending,
        over: !!v.over
      };
    }

    if (v.phase === 'deal') {
      if (!S.deal) { S.deal = { t0: Date.now(), per: 40 }; S.fx = {}; S.prevPlays = 0; SFX.play('deal'); }
      S.phase = 'deal';
      clearTurnTimer();
    } else {
      S.deal = null;
      S.phase = v.phase;
    }

    var plays = S.game ? S.game.trickPlays.length : 0;
    if (plays > (S.prevPlays || 0)) {
      var last = S.game.trickPlays[plays - 1];
      fxPlayed(S.game, last.player);
    }
    S.prevPlays = v.phase === 'play' ? plays : 0;

    if (v.phase === 'play') {
      S.hint = v.turn === 0 ? (v.combo ? '轮到你，压不过可过牌' : '你起手，必须出牌') : SEAT_NAMES[v.turn] + ' 出牌中';
      if (v.deadline) startNetTimer(v.deadline);
      else clearTurnTimer();
    } else {
      clearTurnTimer();
      if (v.phase !== 'tribute') S.hint = '';
    }

    if (v.phase === 'tribute' && v.tribute) {
      var T = v.tribute;
      S.tribute = {
        plan: { count: T.count || 0, winnerRanks: T.winnerRanks || [], winners: [], losers: T.canDraw || [], skip: false },
        draws: T.draws || [],
        reveals: T.reveals || [],
        log: (T.log || []).slice(-6),
        shares: [],
        need: T.need || 0,
        stage: T.stage || 'draw',
        canDraw: T.canDraw || [],
        pull: T.pull || null,
        ret: T.ret || null,
        targetRel: (typeof T.targetRel === 'number') ? T.targetRel : -1,
        turnW: (typeof T.turnWRel === 'number') ? T.turnWRel : -1,
        picks: T.picks || [],
        returned: T.returned || [],
        myTurn: !!T.myTurnToDraw,
        t0: (S.tribute && S.tribute.round === v.round &&
          (S.tribute.draws || []).length === (T.draws || []).length) ? S.tribute.t0 : Date.now(),
        round: v.round,
        humanIsWinner: (T.winnersRel || []).indexOf(0) >= 0,
        humanDrawn: (T.draws || []).filter(function (d) { return d.to === 0; })
      };
      if (S.tribute.humanIsWinner && S.tribute.stage === 'draw') S.hint = '点对方座位抽牌';
      else if (S.tribute.stage === 'return' && S.tribute.need > 0) S.hint = '选 ' + S.tribute.need + ' 张还贡';
    } else {
      S.tribute = null;
    }

    if (v.phase === 'settle' && v.lastResult) {
      var R = v.lastResult;
      S.lastResult = {
        camp: { mode: R.mode, lone: R.loneRel, teamA: R.teamA || [], teamB: R.teamB || [] },
        ranks: R.ranks,
        scores: R.scores,
        winRanks: R.winRanks || []
      };
      if (!S.fx.settleT0) {
        S.fx.settleT0 = Date.now();
        SFX.play(R.scores[0] > 0 ? 'win' : R.scores[0] < 0 ? 'lose' : 'pass');
      }
    } else if (v.phase !== 'settle') {
      S.lastResult = null;
      S.fx.settleT0 = 0;
    }

    S.selected = [];
    P.markDirty();
  }

  // ---------- 开局 ----------
  function newMatch() {
    clearTurnTimer();
    clearTributeTimer();
    if (dealTick) { clearInterval(dealTick); dealTick = null; }
    S.deal = null;
    S.fx = {};
    S.scores = [0, 0, 0, 0];
    S.round = 0;
    S.lastResult = null;
    S.summary = false;
    S.phase = 'idle';
    S.game = null;
    S.resetPending = 0;
    startRound();
  }

  function startRound() {
    clearTurnTimer();
    clearTributeTimer();
    S.round++;
    S.selected = [];
    S.hint = '';
    S.summary = false;
    S.fx = {};
    S.tribute = null;
    S.busy = false;
    var seed = Math.floor(Math.random() * 4e9);
    S.game = GX.Table.createRound({ seed: seed, config: S.cfg });

    // 发牌动画：52 张按逆时针一人一张，约 2.1 秒
    S.phase = 'deal';
    S.deal = { t0: Date.now(), per: 40 };
    P.markDirty();
    if (dealTick) clearInterval(dealTick);
    var ticked = 0;
    dealTick = setInterval(function () {
      if (!S.deal || ticked >= 13) { clearInterval(dealTick); dealTick = null; return; }
      SFX.play('deal');
      ticked++;
    }, 160);
    setTimeout(function () { if (S.phase === 'deal') finishDeal(); }, 52 * 40 + 90);
  }

  var dealTick = null;

  // 发牌结束：进入进贡或直接开打
  function finishDeal() {
    if (S.phase !== 'deal') return;
    if (dealTick) { clearInterval(dealTick); dealTick = null; }
    S.deal = null;
    if (!S.game) return;

    if (S.mode === 'solo' && S.round >= 2 && S.cfg.tributeEnabled && S.lastResult) {
      var plan = GX.Tribute.plan(S.lastResult, S.cfg);
      if (!plan.skip && plan.count > 0) {
        S.tribute = {
          plan: plan,
          draws: [],
          reveals: [],
          log: [],
          shares: GX.Tribute.distribute(plan.count, plan.winners.length),
          need: 0,
          stage: 'draw',
          humanIsWinner: plan.winners.indexOf(0) >= 0,
          humanDrawn: []
        };
        S.tribute.need = S.tribute.humanIsWinner
          ? S.tribute.shares[plan.winners.indexOf(0)] : 0;
        S.tribute.counts = plan.winners.map(function () { return 0; });
        S.phase = 'tribute';
        tributeSchedule(AUTO ? 60 : 700);
        P.markDirty();
        return;
      }
    }
    S.phase = 'play';
    P.markDirty();
    scheduleAI();
  }

  // ---------- 进贡 ----------
  function drawFromSeat(p) {
    var T = S.tribute;
    if (!T || T.stage !== 'draw') return;
    if (T.plan && T.plan.losers && T.plan.losers.indexOf(p) < 0) { toast('只能从败方手里抽'); return; }
    if (S.mode === 'online') {
      if ((T.canDraw || []).indexOf(p) < 0) { toast('这个人已经抽过了'); return; }
      NET.send({ t: 'drawPick', seatRel: p });
      return;
    }
    if (!T.humanIsWinner) return;
    if ((T.humanDrawn || []).length >= (T.need || 0)) return;
    T.stage = 'pull';
    var lone = !!(T.plan && T.plan.winners && T.plan.winners.length === 1);
    var losersAll = lone ? ((T.plan && T.plan.losers) || [p]) : [p];
    var rows = losersAll.map(function (r) { return { rel: r, n: S.game.players[r].hand.length }; });
    T.pull = { rows: rows, done: 0, total: T.need * rows.length, count: T.need, roundStart: (T.draws || []).length };
    S.hint = '点牌背抽一张';
    P.markDirty();
    return;
  }

  // 摊牌后点某家第 idx 张：抽走一张
  function pullOne(rel, idx) {
    var T = S.tribute;
    if (!T || T.stage !== 'pull' || !T.pull) return;
    if (S.mode === 'online') { NET.send({ t: 'pullPick', seatRel: rel, idx: idx }); return; }
    var p = rel;
    var hand = S.game.players[p].hand;
    if (!hand.length) return;
    var k = Math.max(0, Math.min(idx, hand.length - 1));
    var c = hand[k];
    if (GX.Tribute.isIdentity(c)) {
      T.reveals.push({ owner: p, card: c });
      T.log.push({ text: SEAT_NAMES[p] + ' 的 ' + suitRank(c) + ' 是身份牌，亮出归还后重抽', kind: 'warn' });
      S.game.players[p].revealed = true;
      S.game.players[p].revealedCards = (S.game.players[p].revealedCards || []).concat([c.r]);
      S.game.players[p].revealedCard = c.r;
      P.markDirty();
      return;
    }
    hand.splice(k, 1);
    S.game.players[0].hand.push(c);
    sortHand(S.game.players[0].hand);
    T.draws.push({ from: p, to: 0, card: c });
    T.humanDrawn.push({ from: p, card: c });
    T.log.push({ text: '从 ' + SEAT_NAMES[p] + ' 抽到 ' + suitRank(c), kind: 'draw' });
    T.pull.done++;
    (T.pull.rows || []).forEach(function (r) { if (r.rel === p) r.n = hand.length; });
    SFX.play('draw');
    S.fx.drawT0 = Date.now();
    if (T.pull.done >= (T.pull.total || T.need)) {
      // 抽满 → 还贡：按被抽走的牌从大到小，一张一张还
      var rq = (T.draws || []).slice(T.pull.roundStart || 0);
      rq.sort(function (a, b) {
        var d = (GX.Rules.rankVal(b.card.r, S.cfg.rankOrder) - GX.Rules.rankVal(a.card.r, S.cfg.rankOrder));
        return d || (a.card.s - b.card.s);
      });
      T.retQueue = rq;
      T.retIdx = 0;
      T.stage = 'return';
      S.hint = '逐张还贡（1/' + rq.length + '）';
    } else {
      S.hint = '再抽一张（' + T.pull.done + '/' + (T.pull.total || T.need) + '）';
    }
    P.markDirty();
    return;
  }

  function retRemaining() {
    var T = S.tribute;
    if (!T) return 0;
    if (T.ret) return Math.max(0, T.ret.total - T.ret.idx);
    return Math.max(0, (T.retQueue || []).length - (T.retIdx || 0));
  }

  // 还贡：点手牌只是勾选/取消，点「还贡」按钮才真正提交
  function toggleReturnSelect(c) {
    var T = S.tribute;
    if (!T || T.stage !== 'return' || !c) return;
    var at = -1;
    S.selected.forEach(function (x, i) { if (x.r === c.r && x.s === c.s) at = i; });
    if (at >= 0) {
      S.selected.splice(at, 1);
      S.hint = '已选 ' + S.selected.length + ' 张，点「还贡」提交';
      P.markDirty();
      return;
    }
    if (S.selected.length >= retRemaining()) {
      toast('还贡只剩 ' + retRemaining() + ' 张要还');
      return;
    }
    S.selected.push({ r: c.r, s: c.s });
    SFX.play('select');
    S.hint = '已选 ' + S.selected.length + ' 张，点「还贡」提交';
    P.markDirty();
  }

  // 本地逐张执行还贡（按 retQueue 顺序）
  function returnOneLocal(c) {
    var T = S.tribute;
    var cur = (T.retQueue || [])[T.retIdx];
    if (!cur) return;
    var hd = S.game.players[0].hand;
    var idx = hd.findIndex(function (x) { return x.r === c.r && x.s === c.s; });
    if (idx < 0) return;
    hd.splice(idx, 1);
    S.game.players[cur.from].hand.push({ r: c.r, s: c.s });
    sortHand(hd);
    T.returned.push({ from: 0, to: cur.from, card: { r: c.r, s: c.s } });
    T.log.push({ text: '还 ' + suitRank(c) + ' 给 ' + SEAT_NAMES[cur.from], kind: 'ret' });
    T.retIdx++;
  }

  function confirmReturn() {
    var T = S.tribute;
    if (!T || T.stage !== 'return') return;
    if (!S.selected.length) { toast('先选要还的牌，再点还贡'); return; }
    var left = retRemaining();
    if (S.selected.length > left) { toast('最多还能还 ' + left + ' 张'); return; }

    var cards = S.selected.slice();
    S.selected = [];
    if (S.mode === 'online') {
      NET.send({ t: 'retOne', cards: cards });
      P.markDirty();
      return;
    }
    cards.forEach(function (c) { returnOneLocal(c); });
    SFX.play('ret');
    S.fx.retT0 = Date.now();
    if (T.retIdx >= (T.retQueue || []).length) {
      T.stage = 'done';
      finishTribute();
    } else {
      S.hint = '还需要还 ' + retRemaining() + ' 张';
    }
    P.markDirty();
  }

  // 进贡分步执行：一次抽一张，面板上逐条可见
  var tributeTimer = null;

  function clearTributeTimer() {
    if (tributeTimer) { clearTimeout(tributeTimer); tributeTimer = null; }
  }

  function tributeSchedule(delay) {
    clearTributeTimer();
    tributeTimer = setTimeout(tributeStep, delay === undefined ? 420 : delay);
  }

  function aiJobPending(T) {
    for (var i = 0; i < T.plan.winners.length; i++) {
      var w = T.plan.winners[i];
      if (w === 0 && T.humanIsWinner) continue;
      if ((T.counts[i] || 0) < T.shares[i]) return { wi: i, w: w };
    }
    return null;
  }

  function aiReturnGift(T, w, target) {
    var mine = S.game.players[w].hand.slice()
      .filter(function (c) { return !GX.Tribute.isIdentity(c); })
      .sort(function (a, b) {
        return GX.Rules.rankVal(a.r, S.cfg.rankOrder) - GX.Rules.rankVal(b.r, S.cfg.rankOrder);
      });
    if (!mine.length) return;
    var give = mine[0];
    var i2 = S.game.players[w].hand.findIndex(function (x) { return sameCard(x, give); });
    if (i2 < 0) return;
    S.game.players[w].hand.splice(i2, 1);
    S.game.players[target].hand.push(give);
    T.log.push({ text: SEAT_NAMES[w] + ' 还贡 ' + suitRank(give) + ' 给 ' + SEAT_NAMES[target], kind: 'ret' });
  }

  function doTributeDraw(T, wi, w) {
    var plan = T.plan;
    var target = plan.losers[Math.floor(Math.random() * plan.losers.length)];
    var guard = 0;
    while (guard++ < 60) {
      var hand = S.game.players[target].hand;
      if (!hand.length) break;
      var idx = Math.floor(Math.random() * hand.length);
      var card = hand[idx];
      if (GX.Tribute.isIdentity(card)) {
        T.reveals.push({ owner: target, card: card });
        S.game.players[target].revealed = true;
        S.game.players[target].revealedCard = card.r;
        S.game.players[target].revealedCards = (S.game.players[target].revealedCards || []).concat([card.r]);
        T.log.push({ text: SEAT_NAMES[target] + ' 的 ' + suitRank(card) + ' 是身份牌，亮出归还后重抽', kind: 'warn' });
        continue;
      }
      hand.splice(idx, 1);
      S.game.players[w].hand.push(card);
      T.draws.push({ from: target, to: w, card: card });
      T.counts[wi] = (T.counts[wi] || 0) + 1;
      T.log.push({ text: SEAT_NAMES[w] + ' 从 ' + SEAT_NAMES[target] + ' 抽到 ' + suitRank(card), kind: 'draw' });
      if (w !== 0) aiReturnGift(T, w, target);
      return;
    }
    T.counts[wi] = (T.counts[wi] || 0) + 1;
  }

  function tributeStep() {
    tributeTimer = null;
    var T = S.tribute;
    if (!T || S.phase !== 'tribute') return;
    var job = aiJobPending(T);
    if (job) {
      doTributeDraw(T, job.wi, job.w);
      P.markDirty();
      tributeSchedule(AUTO ? 60 : 700);
      return;
    }
    // AI 抽完：真人赢家还要自己抽牌
    if (T.humanIsWinner && T.stage === 'draw' && T.humanDrawn.length < T.need) return;
    if (T.stage === 'draw') {
      T.stage = T.humanIsWinner ? 'return' : 'done';
      if (T.humanIsWinner) S.hint = '选 ' + T.need + ' 张还贡';
    }
    if (!T.humanIsWinner || T.stage === 'done') {
      // 抽完停顿一下，让人看清公示的牌
      if (!T.doneHold) {
        T.doneHold = true;
        P.markDirty();
        tributeSchedule(AUTO ? 120 : 1100);
        return;
      }
      finishTribute();
      return;
    }
    P.markDirty();
  }

  function finishTribute() {
    clearTributeTimer();
    var T = S.tribute;
    var lead = -1;
    if (S.cfg.tributeFirstLead === 'maxCardOwner' && T.draws.length) {
      var best = null;
      T.draws.forEach(function (d) {
        if (!best) { best = d; return; }
        var cmp = GX.Hand.compare(GX.Hand.parse([d.card], S.cfg), GX.Hand.parse([best.card], S.cfg));
        if (cmp > 0) best = d;
      });
      lead = best.from;
    }
    S.game.turn = lead;
    S.game.firstPlayPending = false;
    S.phase = 'play';
    S.tribute = null;
    S.selected = [];
    S.hint = lead >= 0 ? SEAT_NAMES[lead] + ' 被抽走最大牌，先出' : '';
    P.markDirty();
    scheduleAI();
  }

  // ---------- 结算 ----------
  function onNext() {
    if (S.mode === 'online') {
      if (!S.isHost) { toast('等房主开下一局'); return; }
      NET.send({ t: 'next' });
      return;
    }
    if (S.round >= S.rounds) {
      S.summary = true;
      S.phase = 'idle';
      clearTurnTimer();
      P.markDirty();
      return;
    }
    startRound();
  }

  // ---------- 触屏 ----------
  var drag = { on: false, add: true, seen: {} };

  // 手牌按牌力排好（3 最大、4 最小；同点黑桃优先）
  function sortHand(hand) {
    if (!hand || hand.length < 2) return hand;
    var RV = (GX.Rules && GX.Rules.rankVal)
      ? function (r) { return GX.Rules.rankVal(r, S.cfg.rankOrder); }
      : function (r) { return r; };
    hand.sort(function (a, b) {
      var d = RV(b.r) - RV(a.r);
      if (d) return d;
      return b.s - a.s;
    });
    return hand;
  }

  function handCardAt(i) {
    var g = S.game;
    if (!g || !g.players || !g.players[0]) return null;
    return g.players[0].hand[i] || null;
  }

  function isSelected(c) {
    return S.selected.some(function (s) { return s.r === c.r && s.s === c.s; });
  }

  function onDrag(x, y) {
    if (!drag.on || S.phase !== 'play') return;
    var hits = S.hits || [];
    for (var i = hits.length - 1; i >= 0; i--) {
      var h = hits[i];
      if (h.act !== 'card') continue;
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        if (drag.seen[h.i]) return;
        drag.seen[h.i] = 1;
        var c = handCardAt(h.i);
        if (!c) return;
        var sel = isSelected(c);
        if (drag.add && !sel) S.selected.push(c);
        else if (!drag.add && sel) {
          S.selected = S.selected.filter(function (s) { return !(s.r === c.r && s.s === c.s); });
        }
        P.markDirty();
        return;
      }
    }
  }

  function onDragEnd() {
    drag.on = false;
    drag.seen = {};
  }

  function onTap(x, y) {
    SFX.unlock();
    if (S.phase === 'deal') {
      if (S.mode === 'online') { S.deal = null; P.markDirty(); return; }
      finishDeal();
      return;
    }
    var hits = S.hits;
    for (var i = hits.length - 1; i >= 0; i--) {
      var h = hits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        if (h.act === 'card') {
          var c0 = handCardAt(h.i);
          if (c0 && S.tribute && S.tribute.stage === 'return') { toggleReturnSelect(c0); return; }
          if (c0) {
            drag.on = true;
            drag.add = !isSelected(c0);
            drag.seen = {};
            drag.seen[h.i] = 1;
          }
        }
        if (h.act !== 'card') SFX.play('tap');
        handleAct(h);
        return;
      }
    }
  }

  function handleAct(h) {
    if (h.act === 'startGame') { newMatch(); return; }
    if (h.act === 'netOpen') { openLobby(); return; }
    if (h.act === 'cfgRounds') {
      var ro = [8, 12, 16, 24, 32];
      S.rounds = ro[(ro.indexOf(S.rounds) + 1) % ro.length];
      P.markDirty();
      return;
    }
    if (h.act === 'cfgLevel') {
      S.level = (S.level + 1) % 3;
      P.markDirty();
      return;
    }
    if (h.act === 'cfgTribute') {
      if (!S.cfg.tributeEnabled) { S.cfg.tributeEnabled = true; S.cfg.tributeTier = 'heavy'; }
      else if (S.cfg.tributeTier === 'heavy') { S.cfg.tributeTier = 'light'; }
      else { S.cfg.tributeEnabled = false; }
      P.markDirty();
      return;
    }
    if (h.act === 'mode') {
      if (S.mode === 'online') backToSolo(); else openLobby();
      return;
    }
    if (h.act === 'netCreate') { netCreate(); return; }
    if (h.act === 'netConfig') {
      S.lobby = { kind: 'config', url: NET.defaultUrl(), err: '', code: '' };
      P.markDirty();
      return;
    }
    if (h.act === 'cfgSet') {
      if (h.key === 'rounds') S.rounds = h.v;
      else if (h.key === 'tribute') S.roomCfg.tributeTier = h.v;
      else if (h.key === 'seconds') S.roomCfg.turnSeconds = h.v;
      else if (h.key === 'hint') S.roomCfg.teamHint = h.v;
      else if (h.key === 'testTribute') S.roomCfg.testTribute = h.v;
      P.markDirty();
      return;
    }
    if (h.act === 'netCfgConfirm') { netCreate(); return; }
    if (h.act === 'netKeypad') { S.lobby = { kind: 'keypad', code: '', err: '' }; P.markDirty(); return; }
    if (h.act === 'netBack') { backToSolo(); return; }
    if (h.act === 'netDigit') {
      if (S.lobby && S.lobby.code.length < 4) S.lobby.code += h.d;
      P.markDirty();
      return;
    }
    if (h.act === 'netBackspace') {
      if (S.lobby) S.lobby.code = S.lobby.code.slice(0, -1);
      P.markDirty();
      return;
    }
    if (h.act === 'netCancel') {
      S.lobby = { kind: 'entry', url: NET.defaultUrl(), err: '', code: '' };
      P.markDirty();
      return;
    }
    if (h.act === 'netJoin') { if (S.lobby) netJoin(S.lobby.code); return; }
    if (h.act === 'netStart') { NET.send({ t: 'start' }); return; }
    if (h.act === 'netReady') { NET.send({ t: 'ready', v: !S.myReady }); return; }
    if (h.act === 'netLeave') { backToSolo(); return; }
    if (h.act === 'card') { tapCard(h.i); return; }
    if (h.act === 'play') { doPlay(); return; }
    if (h.act === 'pass') { doPass(); return; }
    if (h.act === 'hint') { doHint(); return; }
    if (h.act === 'drawSeat') { drawFromSeat(h.p); return; }
    if (h.act === 'pullCard') { pullOne(h.p, h.idx); return; }
    if (h.act === 'testTribute') { demoPullTest(); return; }
    if (h.act === 'confirmReturn') { confirmReturn(); return; }
    if (h.act === 'toMenu') {
      clearTurnTimer();
      clearTributeTimer();
      S.phase = 'menu';
      S.summary = false;
      S.game = null;
      S.deal = null;
      S.tribute = null;
      P.markDirty();
      return;
    }
    if (h.act === 'next') { onNext(); return; }
    if (h.act === 'round') {
      if (S.mode === 'online') { toast('房次由房主设置'); return; }
      var ro = [8, 12, 16, 24, 32];
      S.rounds = ro[(ro.indexOf(S.rounds) + 1) % ro.length];
      toast('场次：' + S.rounds + ' 局（下局生效）');
      return;
    }
    if (h.act === 'tier') {
      if (S.mode === 'online') { toast('进贡档位由房主设置'); return; }
      S.cfg.tributeTier = S.cfg.tributeTier === 'heavy' ? 'light' : 'heavy';
      toast('进贡：' + (S.cfg.tributeTier === 'heavy' ? '重贡 4/2' : '轻贡 2/1') + '（下局生效）');
      return;
    }
    if (h.act === 'level') {
      if (S.mode === 'online') { toast('联机对手是真人'); return; }
      S.level = (S.level + 1) % 3;
      toast('对手：' + ['新手', '普通', '高手'][S.level]);
      return;
    }
    if (h.act === 'audio') {
      S.audioOn = SFX.toggle();
      toast(S.audioOn ? '音效已开' : '音效已关');
      return;
    }
    if (h.act === 'newMatch') {
      if (S.mode === 'online') { toast('联机中不能重开，点标题可离开房间'); return; }
      if ((S.phase === 'play' || S.phase === 'tribute') && Date.now() > S.resetPending) {
        S.resetPending = Date.now() + 3000;
        toast('再点一次确认重开');
        return;
      }
      newMatch();
      toast('新的一场');
      return;
    }
  }

  function boot() {
    P.init();
    SFX.init();
    P.bindTap(onTap);
    if (P.bindMove) P.bindMove(onDrag);
    if (P.bindEnd) P.bindEnd(onDragEnd);
    P.start(draw);
    if (typeof window !== 'undefined') window.__gx = { S: S, P: P, onTap: onTap };
    if (typeof window !== 'undefined' && window.location &&
        /demo=pullTest/.test(window.location.search || '')) {
      demoPullTest();
      return;
    }
    if (typeof window !== 'undefined' && window.location &&
      /demo=tributeSeq/.test(window.location.search || '')) {
      // 预览用：真实走一遍第 2 局的进贡分步流程（真人不是赢家）
      S.mode = 'solo';
      S.rounds = 8;
      S.cfg.tributeEnabled = true;
      S.cfg.tributeTier = 'heavy';
      S.lastResult = { ranks: [1, 2, 0, 3], camp: { mode: 'team', teamA: [1, 2], teamB: [0, 3] } };
      S.round = 1;
      startRound();
      S.lastResult = { ranks: [1, 2, 0, 3], camp: { mode: 'team', teamA: [1, 2], teamB: [0, 3] } };
      S.round = 2;
      finishDeal();
      return;
    }
    if (typeof window !== 'undefined' && window.location &&
        /demo=tribute/.test(window.location.search || '')) { demoTribute(); return; }
    if (typeof window !== 'undefined' && window.location &&
        /demo=fx/.test(window.location.search || '')) { demoFx(); return; }
    if (typeof window !== 'undefined' && window.location &&
        /demo=flight/.test(window.location.search || '')) { demoFlight(); return; }
    if (typeof window !== 'undefined' && window.location &&
        /demo=lobby/.test(window.location.search || '')) { newMatch(); openLobby(); return; }
    if (typeof window !== 'undefined' && window.location &&
        /demo=cfg/.test(window.location.search || '')) {
      newMatch(); openLobby();
      S.lobby = { kind: 'config', url: NET.defaultUrl(), err: '', code: '' };
      S.mode = 'online'; P.markDirty(); return;
    }
    if (typeof window !== 'undefined' && window.location &&
        /demo=online/.test(window.location.search || '')) { demoOnline(); return; }
    if (typeof window !== 'undefined' && window.location &&
        /demo=keypad/.test(window.location.search || '')) {
      newMatch(); openLobby(); S.lobby = { kind: 'keypad', code: '12', err: '' }; P.markDirty(); return;
    }

    var joinCode = '';
    if (typeof window !== 'undefined' && window.location) {
      var qm = /(?:\?|&)room=(\d{4})/.exec(window.location.search || '');
      if (qm) joinCode = qm[1];
    }
    if (joinCode) {
      S.phase = 'menu';
      openLobby();
      netJoin(joinCode);
      return;
    }
    if (AUTO) { newMatch(); return; }
    S.phase = 'menu';
    P.markDirty();
  }

  // 仅预览用：把对局推进到桌面已有 3 手，并冻结在飞牌动画中途
  function demoFx() {
    var m = /fx=([0-9.]+)/.exec(window.location.search || '');
    var km = /kind=([a-z]+)/.exec(window.location.search || '');
    newMatch();
    S.fxDemoP = m ? parseFloat(m[1]) : 0.35;
    S.fxDemoKind = km ? km[1] : '';
    P.markDirty();
  }

  function demoFlight() {
    S.game = GX.Table.createRound({ seed: 11, config: S.cfg });
    S.phase = 'play';
    var g = S.game, guard = 0;
    while (g.trickPlays.length < 3 && guard++ < 30 && !g.over) {
      var p = g.turn;
      var a = GX.AI2.decide(g, p, 1);
      if (a.type === 'play') GX.Table.play(g, p, a.cards);
      else if (GX.Table.pass(g, p)) {
        var ok = GX.Moves.candidates(g.players[p].hand, S.cfg)
          .filter(function (c) { return GX.Table.validate(g, p, c.cards) === null; });
        if (ok.length) GX.Table.play(g, p, GX.Moves.lowest(ok).cards);
      }
    }
    S.players = null;
    S.fx = { playT0: Date.now(), seatPlay: { p: g.trickPlays[g.trickPlays.length - 1].player, t0: Date.now() } };
    S.fxForce = 0.3;
    P.markDirty();
  }

  // 仅预览用：伪造一个联机视图，核对联机界面渲染
  function demoOnline() {
    var g = GX.Table.createRound({ seed: 20261119, config: S.cfg });
    S.mode = 'online';
    S.scores = [0, 0, 0, 0];
    var deck = [];
    for (var s = 0; s < 4; s++) {
      for (var r = 4; r <= 14; r++) deck.push({ r: r, s: s });
    }
    var hand = deck.slice(0, 13);
    var seats = [
      { name: '真人', ai: false, ready: true, isYou: true, count: hand.length, revealedCards: [], score: 0, online: true },
      { name: '西风', ai: false, ready: true, isYou: false, count: 13, revealedCards: [], score: 0, online: true },
      { name: '北岸', ai: false, ready: true, isYou: false, count: 13, revealedCards: [{ r: 3 }], score: 0, online: true },
      { name: '东东', ai: true, ready: true, isYou: false, count: 12, revealedCards: [], score: 0, online: true }
    ];
    applyView({
      t: 'state', room: '1000', phase: 'play', round: 3, rounds: 12, seats: seats,
      hand: hand,
      trickPlays: [
        { player: 1, cards: [{ r: 5, s: 1 }], combo: null },
        { player: 2, cards: [{ r: 7, s: 2 }], combo: null }
      ],
      turn: 0, combo: null, firstPlayPending: false, over: false,
      deadline: Date.now() + 15000, host: true, lastEvent: '西风 出牌'
    });
    S.hint = '轮到你出牌';
    P.markDirty();
  }

  // 仅预览用：开局直接进贡（可交互：点座位 → 摊牌 → 点牌背 → 还贡）
  function demoPullTest() {
    S.mode = 'solo';
    S.round = 2;
    S.rounds = 8;
    S.cfg.tributeEnabled = true;
    S.game = GX.Table.createRound({ seed: 99, config: S.cfg });
    S.scores = [0, 0, 0, 0];
    S.phase = 'tribute';
    S.hint = '点金框对手的座位';
    S.selected = [];
    S.tribute = {
      plan: { count: 2, winners: [0, 2], losers: [1, 3], winnerRanks: [1, 3], skip: false },
      draws: [], reveals: [], log: [], shares: [2, 2],
      need: 2, stage: 'draw', canDraw: [1, 3], turnW: 0, picks: [], returned: [],
      pull: null, humanIsWinner: true, humanDrawn: [], t0: Date.now()
    };
    if (typeof window !== 'undefined' && window.location) {
      var q = window.location.search || '';
      if (/stage=pull3/.test(q)) {
        // 独食：三家同时摊开，一轮抽 3N 张
        S.tribute.plan = { count: 2, winners: [0], losers: [1, 2, 3], winnerRanks: [1], skip: false };
        S.tribute.need = 6;
        S.tribute.stage = 'pull';
        S.tribute.pull = {
          rows: [1, 2, 3].map(function (r) { return { rel: r, n: S.game.players[r].hand.length }; }),
          done: 0, total: 6, count: 2, roundStart: 0
        };
        S.hint = '点任意一排的牌背抽牌';
      } else if (/stage=pull/.test(q)) {
        S.tribute.stage = 'pull';
        S.tribute.pull = {
          rows: [{ rel: 1, n: S.game.players[1].hand.length }],
          done: 0, total: 2, count: 2, roundStart: 0
        };
        S.hint = '点牌背抽一张';
      } else if (/stage=return/.test(q)) {
        S.tribute.stage = 'return';
        var drawn = [{ from: 1, to: 0, card: { r: 13, s: 3 } }, { from: 1, to: 0, card: { r: 6, s: 2 } }];
        drawn.forEach(function (d) {
          var ph = S.game.players[d.from].hand;
          var ii = ph.findIndex(function (x) { return x.r === d.card.r && x.s === d.card.s; });
          if (ii >= 0) { ph.splice(ii, 1); S.game.players[0].hand.push(d.card); }
        });
        sortHand(S.game.players[0].hand);
        S.tribute.draws = drawn;
        S.tribute.retQueue = drawn.slice().sort(function (a, b) {
          return GX.Rules.rankVal(b.card.r, S.cfg.rankOrder) - GX.Rules.rankVal(a.card.r, S.cfg.rankOrder);
        });
        S.tribute.retIdx = 0;
        S.tribute.humanDrawn = drawn.slice();
        S.tribute.picks = [1];
        S.tribute.log = [{ text: '从 西家 抽到 ♦6、♠K', kind: 'draw' }];
        S.hint = '点手牌选中，再点还贡按钮提交';
        if (/sel=1/.test(q)) S.selected = S.tribute.retQueue.slice(0, 2).map(function (d) { return { r: d.card.r, s: d.card.s }; });
      }
    }
    P.markDirty();
  }

  // 仅预览用：直接渲染进贡面板，便于核对排版
  function demoTribute() {
    S.game = GX.Table.createRound({ seed: 7, config: S.cfg });
    S.round = 2;
    S.phase = 'tribute';
    S.hint = '选 2 张还贡';
    S.tribute = {
      plan: { count: 2, winners: [0, 2], losers: [1, 3], winnerRanks: [1, 3], skip: false },
      draws: [
        { from: 1, to: 0, card: { r: 7, s: 1 } },
        { from: 3, to: 0, card: { r: 11, s: 2 } }
      ],
      reveals: [{ owner: 3, card: { r: 14, s: 3 } }],
      log: [
        { text: '西家 的 ♣7 被抽走', kind: 'draw' },
        { text: '东家 的 ♠A 是身份牌，亮出归还后重抽', kind: 'warn' },
        { text: '从 东家 抽到 ♥J', kind: 'draw' }
      ],
      shares: [2, 2],
      need: 2,
      stage: 'return',
      canDraw: [],
      turnW: -1,
      picks: [1, 3],
      returned: [],
      t0: Date.now() - 4000,
      humanIsWinner: true,
      humanDrawn: [{ from: 1, card: { r: 7, s: 1 } }, { from: 3, card: { r: 11, s: 2 } }]
    };
    if (typeof window !== 'undefined' && window.location &&
        /demo=tributeDraw/.test(window.location.search || '')) {
      S.tribute.stage = 'draw';
      S.tribute.turnW = 1;
      S.tribute.picks = [1];
      S.tribute.canDraw = [3];
      S.tribute.need = 0;
      S.tribute.draws = [];
      S.tribute.humanIsWinner = true;
      S.hint = '点金框的对手抽牌';
    }
    P.markDirty();
  }

  var exp = { boot: boot, S: S };
  if (typeof module === 'object' && module.exports) module.exports = exp;
  else (window.APP = exp);
})();
