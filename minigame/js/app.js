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
    mode: 'menu',
    lobby: null,
    waitRoom: false,
    room: '',
    isHost: false,
    myReady: false,
    seats: [],
    netStatus: '',
    netView: null,
    prevPlays: 0,
    // 昵称 / 发言
    myName: '',
    chats: [],
    chatOpen: false,
    chatTab: 'emoji',
    chatT0: 0,
    // 辅助与面板
    auto: false,          // 托管
    autoPending: false,
    hintIdx: 0,           // 提示候选轮换游标
    recordOpen: false,    // 记牌器
    toolsOpen: false,     // 更多（工具抽屉）
    pauseOpen: false,     // 对局内菜单（返回主界面 / 托管 / 引导 …）
    statsOpen: false,     // 战绩
    replayOpen: false,    // 复盘
    guideOpen: false,     // 新手引导
    guidePage: 0,
    vibOn: true,
    skin: 0,              // 牌背皮肤
    stats: null,          // 本地战绩
    replay: [],           // 本局出牌序列（复盘用）
    rejoin: null,         // {room, key} 断线重连凭据
    reconnecting: false,
    leaving: false,       // 主动离开：不触发重连
    reconnectTries: 0,
    lastChatTs: 0,        // 最近一次播过提示音的发言
    streakNow: 0,
    lastSettleKey: '',
    guideDone: false,
    musicOn: false,
    ask: null             // 二次确认弹窗：null / {kind:'exit'} / {kind:'dissolve'}
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
      (S.fx.identityT0 && now - S.fx.identityT0 < 1000) ||
      (S.fx.settleT0 && now - S.fx.settleT0 < 1020) ||
      (S.fx.loneRevealT0 && now - S.fx.loneRevealT0 < 1700) ||
      (S.chatOpen && S.chatT0 && now - S.chatT0 < 220)) P.markDirty();
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
    S.hintIdx = 0;
    armAuto();
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
      recordRow(0, null, true);
      P.markDirty();
      scheduleAI();
      return;
    }
    var cands = GX.Moves.candidates(g.players[0].hand, S.cfg);
    var ok = cands.filter(function (c) { return GX.Table.validate(g, 0, c.cards) === null; });
    if (ok.length) {
      var low = GX.Moves.lowest(ok);
      GX.Table.play(g, 0, low.cards);
      S.hint = '超时：起手必须出牌，已出最小牌';
      recordRow(0, low.cards, false);
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
    if (S.auto) cancelAuto(true);   // 主动选牌＝收回托管
    var idx = S.selected.findIndex(function (s) { return sameCard(s, c); });
    if (idx >= 0) S.selected.splice(idx, 1);
    else S.selected.push(c);
    S.hint = '';
    S.hintIdx = 0;
    SFX.play('select');
    P.markDirty();
  }

  function doPlay() {
    if (S.mode === 'online') {
      if (!S.game) return;
      if (S.game.turn !== 0) { S.hint = '还没轮到你'; P.markDirty(); return; }
      var onCards = S.selected.slice();
      if (!onCards.length) { S.hint = '先选牌'; P.markDirty(); return; }
      if (S.auto) cancelAuto(true);
      NET.send({ t: 'play', cards: onCards });
      recordRow(0, onCards, false);
      S.selected = [];
      S.hint = '';
      S.hintIdx = 0;
      P.markDirty();
      return;
    }
    var g = S.game;
    var cards = S.selected.slice();
    if (!cards.length) { S.hint = '先选牌'; P.markDirty(); return; }
    var err = GX.Table.validate(g, 0, cards);
    if (err) { S.hint = explain(err); P.markDirty(); return; }
    if (S.auto) cancelAuto(true);
    GX.Table.play(g, 0, cards);
    recordRow(0, cards, false);
    S.selected = [];
    S.hint = '';
    S.hintIdx = 0;
    fxPlayed(g, 0);
    P.markDirty();
    maybeFinishRound();
    scheduleAI();
  }

  function doPass() {
    if (S.auto) cancelAuto(true);
    if (S.mode === 'online') {
      NET.send({ t: 'pass' });
      recordRow(0, null, true);
      S.selected = [];
      P.markDirty();
      return;
    }
    var err = GX.Table.pass(S.game, 0);
    if (err) { S.hint = explain(err); P.markDirty(); return; }
    recordRow(0, null, true);
    S.selected = [];
    SFX.play('pass');
    P.markDirty();
    scheduleAI();
  }

  // 提示：点一下换一种打法。候选按牌力从小到大排，超出范围就过滤掉
  function doHint() {
    var g = S.game;
    if (!g || g.turn !== 0) return;
    var cands = GX.Moves.candidates(g.players[0].hand, S.cfg);
    var ok;
    if (S.mode === 'online') {
      if (g.firstPlayPending) {
        cands = cands.filter(function (c) {
          return c.cards.some(function (x) { return x.r === 4 && x.s === 0; });
        });
      }
      ok = cands;
      if (g.combo) ok = ok.filter(function (c) { return GX.Hand.compare(c.combo, g.combo) > 0; });
    } else {
      ok = cands.filter(function (c) { return GX.Table.validate(g, 0, c.cards) === null; });
      if (g.combo) ok = ok.filter(function (c) { return GX.Hand.compare(c.combo, g.combo) > 0; });
    }
    if (!ok.length) {
      S.hint = g.combo ? '这手压不过，只能过牌' : '没有合法牌型';
      P.markDirty();
      return;
    }
    // 同一组牌型只留最小的一手，按牌力升序，逐个轮换
    var uniq = [];
    ok.forEach(function (c) {
      var k = GX.Hand.kindLabel(c.combo.kind) + '|' + c.cards.length + '|' +
        c.cards.map(function (x) { return x.r + '.' + x.s; }).sort().join(',');
      if (!uniq.some(function (u) { return u.k === k; })) uniq.push({ k: k, c: c });
    });
    uniq.sort(function (a, b) { return GX.Hand.compare(a.c.combo, b.c.combo); });
    S.hintIdx = (S.hintIdx + 1) % uniq.length;
    var pick = uniq[S.hintIdx].c;
    S.selected = pick.cards.slice();
    S.hint = '提示 ' + (S.hintIdx + 1) + '/' + uniq.length + '：' + GX.Hand.kindLabel(pick.combo.kind) +
      '（再点换一换）';
    SFX.play('select');
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

  // 身份牌（♠3/♠A）亮出特效：在既有 S.fx 体系上追加字段，不改 kindFx 任何签名与记录逻辑
  function fxIdentitySet(seat, rank) {
    S.fx.identityT0 = Date.now();
    S.fx.identitySeat = seat;
    S.fx.identityRank = rank;
    SFX.play('identity');
  }
  function fxIdentityCards(cards, seat) {
    var idc = (cards || []).filter(function (c) { return c.s === 3 && (c.r === 3 || c.r === 14); });
    if (idc.length) fxIdentitySet(seat, idc[0].r);
  }

  // 独食全屏揭示触发：某座位 revealedCards 同时含 3 与 14 → loneRevealT0/loneSeat。
  // loneRevealT0 兼任「本局已触发」守卫（S.fx 每局重置），重复检查幂等无害。
  function fxLoneCheck() {
    if (!S.game || !S.game.players || S.fx.loneRevealT0) return;
    for (var i = 0; i < S.game.players.length; i++) {
      var rc = S.game.players[i].revealedCards || [];
      var has3 = false, hasA = false;
      for (var j = 0; j < rc.length; j++) {
        var v = (rc[j] && typeof rc[j] === 'object') ? rc[j].r : rc[j]; // 兼容 {r:n} 形态
        if (v === 3) has3 = true;
        else if (v === 14) hasA = true;
      }
      if (has3 && hasA) {
        S.fx.loneRevealT0 = Date.now();
        S.fx.loneSeat = i;
        SFX.play('lone');
        return;
      }
    }
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
    S.fx.cards = (last && last.cards) || null; // 记录该手牌数组：kindFx 同花按实际花色着色
    SFX.play('shock');
    SFX.playKind(k);
    SFX.say(k, S.fx.cards); // 语音播报这手牌型（单张报点数）
    S.fx.seatPlay = { p: seat, t0: Date.now() };
    if (seat === 0 && S.vibOn) P.haptic('heavy');
    fxIdentityCards(last && last.cards, seat); // 本手含 ♠3/♠A → 身份特效
    fxLoneCheck(); // 出牌后直接判：revealedCards 齐 ♠3+♠A → 独食揭示
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
        recordRow(p, action.cards, false);
        SFX.play('play');
        S.hint = '';
        S.fx.playT0 = Date.now();
        S.fx.shockT0 = Date.now();
        // 与 fxPlayed 同一记录机制：同步该手牌型与牌面，避免横幅/同花着色沿用手上一手
        var tps = S.game.trickPlays || [];
        var tl = tps.length ? tps[tps.length - 1] : null;
        S.fx.kind = (tl && tl.combo && tl.combo.kind) || 'single';
        S.fx.cards = (tl && tl.cards) || null;
        SFX.play('shock');
        SFX.say(S.fx.kind, S.fx.cards); // 与 fxPlayed 同口径：AI 直出也播报
        S.fx.seatPlay = { p: p, t0: Date.now() };
        fxIdentityCards(tl && tl.cards, p); // 与 fxPlayed 同一触发口径：♠3/♠A 亮出
        fxLoneCheck(); // 与 fxPlayed 同一口径：独食揭示
      } else if (GX.Table.pass(S.game, p)) {
        recordRow(p, null, true);
        var cands = GX.Moves.candidates(S.game.players[p].hand, S.cfg);
        var ok = cands.filter(function (c) { return GX.Table.validate(S.game, p, c.cards) === null; });
        if (ok.length) {
          var lowAI = GX.Moves.lowest(ok);
          GX.Table.play(S.game, p, lowAI.cards);
          recordRow(p, lowAI.cards, false);
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
    S.chatOpen = false;
    S.chatTab = 'emoji';
    S.chatT0 = 0;
    S.fx.settleT0 = Date.now();
    // 战绩：只统计「我」这一侧；连胜在结算页显示
    var st = recordResult(res.scores[0]);
    S.streakNow = st.streak;
    if (S.vibOn) P.haptic('light');
    SFX.play(res.scores[0] > 0 ? 'win' : res.scores[0] < 0 ? 'lose' : 'pass');
    P.markDirty();
    if (AUTO) setTimeout(function () { onNext(); }, 900);
  }

  // ---------- 联机 ----------
  var netBound = false;

  var NAME_KEY = 'gx13_myname';

  function loadName() {
    var n = '';
    try {
      if (typeof wx !== 'undefined' && wx.getStorageSync) n = wx.getStorageSync(NAME_KEY) || '';
      else if (typeof localStorage !== 'undefined') n = localStorage.getItem(NAME_KEY) || '';
    } catch (e) {}
    if (n) return String(n).slice(0, 6);
    if (typeof window !== 'undefined' && window.location) {
      var q = /(?:\?|&)name=([^&]+)/.exec(window.location.search || '');
      if (q) return decodeURIComponent(q[1]).slice(0, 6);
    }
    return '';
  }

  function saveName(n) {
    S.myName = String(n || '').slice(0, 6);
    try {
      if (typeof wx !== 'undefined' && wx.setStorageSync) wx.setStorageSync(NAME_KEY, S.myName);
      else if (typeof localStorage !== 'undefined') localStorage.setItem(NAME_KEY, S.myName);
    } catch (e) {}
  }

  function myName() {
    return S.myName || '玩家';
  }

  // 改名：房间内立即广播给同桌；房间外先存本地，建房/加入时带上
  function askName() {
    P.askText('给自己起个名字（最多 6 字）', myName(), 6, function (v) {
      var nm = String(v || '').replace(/\s+/g, ' ').trim().slice(0, 6);
      if (!nm) return;
      saveName(nm);
      if (S.mode === 'online' && S.room) NET.send({ t: 'rename', name: nm });
      toast('昵称已改为 ' + nm);
      P.markDirty();
    });
  }

  function sendChat(kind, text) {
    if (S.mode !== 'online' || !S.room) { toast('联机房间里才能发言'); return; }
    NET.send({ t: 'chat', kind: kind, text: text });
    // 先本地回显，等服务端 state 回来再对齐（避免「发完看不到自己说了什么」）
    S.chats = (S.chats || []).concat([{ rel: 0, kind: kind, text: text, ts: Date.now(), pending: true }]);
    if (S.chats.length > 12) S.chats = S.chats.slice(-12);
    if (S.chatOpen) SFX.play('chat');
    P.markDirty();
  }

  // 打字发言：微信走 showKeyboard，浏览器走 prompt
  function typeChat() {
    P.askText('说点什么（≤16 字）', '', 16, function (v) {
      var t = String(v || '').replace(/\s+/g, ' ').trim().slice(0, 16);
      if (t) sendChat('text', t);
    });
  }

  // 预置表情/短语：画布内不调输入法，点一下即发
  var CHAT_EMOJI = ['😀', '😄', '😎', '🤔', '😭', '😡', '👍', '👏', '🎉', '🃏', '🙏', '🤝', '💤', '🔥', '🍀', '👀'];
  var CHAT_PHRASES = ['快点吧', '出牌真快', '承让了', '别催我', '我再想想', '再来一局', '这牌没法打', '稳住别浪'];

  // ---------- 本地存档（战绩 / 引导 / 震动 / 皮肤） ----------
  function storageGet(key, def) {
    try {
      var raw;
      if (typeof wx !== 'undefined' && wx.getStorageSync) raw = wx.getStorageSync(key);
      else if (typeof localStorage !== 'undefined') raw = localStorage.getItem(key);
      if (raw === '' || raw === undefined || raw === null) return def;
      if (typeof raw !== 'string') return raw;
      var t = raw.trim();
      if (t.charAt(0) === '{' || t.charAt(0) === '[') {
        try { return JSON.parse(t); } catch (e) { return def; }
      }
      return raw;
    } catch (e) {}
    return def;
  }

  function storageSet(key, val) {
    try {
      if (val === null || val === undefined) {
        if (typeof wx !== 'undefined' && wx.removeStorageSync) { wx.removeStorageSync(key); return; }
        if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
        return;
      }
      if (typeof wx !== 'undefined' && wx.setStorageSync) { wx.setStorageSync(key, val); return; }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
      }
    } catch (e) {}
  }

  var STATS_KEY = 'gx13_stats';
  var GUIDE_KEY = 'gx13_guide_done';

  function loadStats() {
    var d = storageGet(STATS_KEY, null);
    if (!d || typeof d !== 'object') d = {};
    return {
      games: d.games || 0, wins: d.wins || 0, losses: d.losses || 0, draws: d.draws || 0,
      streak: d.streak || 0, bestStreak: d.bestStreak || 0, best: d.best || 0,
      history: Array.isArray(d.history) ? d.history.slice(-20) : [],
      top: Array.isArray(d.top) ? d.top.slice(0, 5) : []
    };
  }

  // 一局结束记一笔：我的本局分 > 0 记胜，< 0 记负，= 0 记平
  function recordResult(myScore) {
    var st = S.stats || loadStats();
    st.games++;
    if (myScore > 0) { st.wins++; st.streak = st.streak > 0 ? st.streak + 1 : 1; }
    else if (myScore < 0) { st.losses++; st.streak = st.streak < 0 ? st.streak - 1 : -1; }
    else { st.draws++; st.streak = 0; }
    st.bestStreak = Math.max(st.bestStreak || 0, st.streak);
    st.best = Math.max(st.best || 0, myScore);
    st.history.push({ t: Date.now(), score: myScore, win: myScore > 0 ? 1 : myScore < 0 ? -1 : 0, mode: S.mode });
    if (st.history.length > 20) st.history = st.history.slice(-20);
    // 本机排行榜：单局分前 5（本地存，不上云）
    st.top = Array.isArray(st.top) ? st.top : [];
    st.top.push({ score: myScore, t: Date.now() });
    st.top.sort(function (a, b) { return b.score - a.score; });
    st.top = st.top.slice(0, 5);
    S.stats = st;
    storageSet(STATS_KEY, st);
    return st;
  }

  function recordRow(seat, cards, pass) {
    S.replay.push({
      seat: seat, pass: !!pass,
      cards: (cards || []).slice().map(function (c) { return { r: c.r, s: c.s }; })
    });
    if (S.replay.length > 240) S.replay.splice(0, S.replay.length - 240);
  }

  // 记牌器：52 张里减去我手上的和场上已经打出的，得到外面还剩几张（按点数 4..14 计）
  function remainingByRank() {
    var cnt = {};
    for (var r = 4; r <= 14; r++) cnt[r] = 4;
    var g = S.game;
    var mine = (g && g.players && g.players[0]) ? g.players[0].hand : [];
    mine.forEach(function (c) { if (cnt[c.r] !== undefined) cnt[c.r]--; });
    ((g && g.trickPlays) || []).forEach(function (pl) {
      (pl.cards || []).forEach(function (c) { if (cnt[c.r] !== undefined) cnt[c.r]--; });
    });
    // 进贡抽走的牌也是从别人手里出来，仍在场上（没打出），不用额外扣
    var out = [];
    for (var x = 14; x >= 4; x--) out.push({ r: x, n: Math.max(0, cnt[x]) });
    return out;
  }

  // 分享文案：本场分 + 连胜（微信被动分享与主动分享共用）
  function shareText() {
    var st = S.stats || loadStats();
    var total = S.scores[0] || 0;
    return '十三张·独食：本场 ' + (total > 0 ? '+' + total : total) + ' 分' +
      (st.streak > 1 ? '，' + st.streak + ' 连胜' : '') + '，来一局？';
  }

  // 分享战绩：微信走原生分享，浏览器退化到复制文本
  function shareResult() {
    var title = shareText();
    try {
      if (typeof wx !== 'undefined' && wx.shareAppMessage) {
        wx.shareAppMessage({ title: title, imageUrl: '' });
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(title);
        toast('战绩文案已复制，可粘贴分享');
        return;
      }
    } catch (e) {}
    toast(title);
  }

  // ---------- 托管：轮到我且长时间没操作，自动出最小合法牌 / 过牌 ----------
  function cancelAuto(quiet) {
    if (!S.auto) return;
    S.auto = false;
    S.autoPending = false;
    if (!quiet) toast('已取消托管');
    P.markDirty();
  }

  function autoAct() {
    S.autoPending = false;
    if (!S.auto) return;
    var g = S.game;
    if (!g || g.over || S.phase !== 'play' || g.turn !== 0 || S.busy) return;
    var cands = GX.Moves.candidates(g.players[0].hand, S.cfg);
    var ok = cands.filter(function (c) { return GX.Table.validate(g, 0, c.cards) === null; });
    if (S.mode === 'online') {
      if (!ok.length) { S.hint = '托管：无牌可出，自动过牌'; NET.send({ t: 'pass' }); P.markDirty(); return; }
      var pick = g.combo
        ? GX.Moves.lowest(ok.filter(function (c) { return GX.Hand.compare(c.combo, g.combo) > 0; }))
        : GX.Moves.lowest(ok);
      if (!pick) { S.hint = '托管：压不过，自动过牌'; NET.send({ t: 'pass' }); P.markDirty(); return; }
      S.selected = pick.cards.slice();
      S.hint = '托管：自动出 ' + GX.Hand.kindLabel(pick.combo.kind);
      NET.send({ t: 'play', cards: pick.cards });
      S.selected = [];
      P.markDirty();
      return;
    }
    if (!ok.length) {
      if (g.combo && GX.Table.pass(g, 0) === null) {
        S.hint = '托管：自动过牌';
        S.selected = [];
        SFX.play('pass');
        recordRow(0, null, true);
        P.markDirty();
        scheduleAI();
        return;
      }
      S.hint = '托管：没有可出的牌';
      P.markDirty();
      return;
    }
    var p2 = g.combo
      ? GX.Moves.lowest(ok.filter(function (c) { return GX.Hand.compare(c.combo, g.combo) > 0; }))
      : GX.Moves.lowest(ok);
    if (p2) {
      GX.Table.play(g, 0, p2.cards);
      S.selected = [];
      S.hint = '托管：自动出 ' + GX.Hand.kindLabel(p2.combo.kind);
      recordRow(0, p2.cards, false);
      fxPlayed(g, 0);
      P.markDirty();
      maybeFinishRound();
      scheduleAI();
      return;
    }
    S.hint = '托管：压不过，只能过牌';
    P.markDirty();
  }

  function armAuto() {
    if (!S.auto || S.autoPending) return;
    if (!S.game || S.phase !== 'play' || S.game.turn !== 0 || S.busy) return;
    S.autoPending = true;
    setTimeout(autoAct, 1100);
  }


  function bindNet() {
    if (netBound) return;
    netBound = true;
    NET.on('open', function () {
      S.netStatus = '已连接';
      if (S.reconnecting && S.rejoin) {
        NET.send({ t: 'rejoin', room: S.rejoin.room, key: S.rejoin.key });
        S.pending = null;
      } else if (S.pending) {
        var pj = S.pending; S.pending = null; NET.send(pj);
      }
      if (S.lobby) S.lobby.err = '';
      if (!S.reconnecting) toast(NET.isCloud ? '已连接云开发' : '已连接服务器');
      P.markDirty();
    });
    NET.on('error', function (e) {
      S.netStatus = '连接失败';
      var msg = (e && e.msg) ? e.msg : (NET.isCloud ? '云开发连接失败，请确认云函数已上传' : ('连不上服务器：' + NET.defaultUrl()));
      if (S.lobby) {
        S.lobby.busy = false;
        S.lobby.err = msg;
      } else {
        toast(msg);
      }
      P.markDirty();
    });
    NET.on('close', function () {
      S.netStatus = '连接断开';
      if (S.mode === 'online' && S.rejoin && !S.leaving) {
        tryReconnect();
        return;
      }
      if (S.leaving) { P.markDirty(); return; }   // 主动退房/回大厅：不要弹“连接断开”盖住操作提示
      if (S.lobby) { S.lobby.busy = false; S.lobby.err = '连接断开，请重试'; }
      toast('连接断开');
      P.markDirty();
    });
    NET.on('message', onNetMessage);
  }

  // 断线重连：掉线后按 1.5s 间隔重试，最多 8 次；重连成功发 rejoin 拿回原座位
  function tryReconnect() {
    if (!S.rejoin || S.reconnectTries >= 8) {
      S.reconnecting = false;
      toast('重连失败，请回大厅重新进房');
      P.markDirty();
      return;
    }
    S.reconnecting = true;
    S.reconnectTries = (S.reconnectTries || 0) + 1;
    S.netStatus = '重连中 ' + S.reconnectTries + '/8';
    toast('连接断了，正在重连…');
    P.markDirty();
    setTimeout(function () {
      if (!S.reconnecting) return;
      NET.connect();
      // 有些平台不回调 onClose→onOpen，这里用状态兜底再发一次
      setTimeout(function () {
        if (S.reconnecting && S.netStatus === '已连接' && S.rejoin) {
          NET.send({ t: 'rejoin', room: S.rejoin.room, key: S.rejoin.key });
        }
      }, 800);
    }, 1500);
  }

  function netJoinServer() {    bindNet();
    if (S.netStatus === '已连接') return true;
    S.netStatus = '连接中…';
    NET.connect();
    return false;
  }

  function openLobby() {
    S.mode = 'online';
    S.leaving = false;
    S.pending = null;
    S.waitRoom = false;
    S.lobby = { kind: 'entry', url: NET.defaultUrl(), err: '', code: '' };
    S.phase = 'lobby';
    bindNet();
    P.markDirty();
  }

  // 回主界面：所有对局都走联机房间，离开时退房并断开本局连接，回到主菜单重新选择
  function doExitHome() {
    returnHome();
  }

  function returnHome() {
    var alreadyLeaving = S.leaving;
    S.leaving = true;
    S.reconnecting = false;
    S.rejoin = null;
    try { storageSet('gx13_rejoin', null); } catch (e) {}
    if (S.mode === 'online') {
      // 被服务端“另一处登录”顶掉时房间映射已失效，再发 leave 只会收到「还没进房间」
      if (!alreadyLeaving) NET.send({ t: 'leave' });
      NET.close();
    }
    clearTurnTimer();
    clearTributeTimer();
    SFX.flush();
    if (dealTick) { clearInterval(dealTick); dealTick = null; }
    S.mode = 'menu';
    S.lobby = null;
    S.pending = null;
    S.waitRoom = false;
    S.netView = null;
    S.room = '';
    S.isHost = false;
    S.myReady = false;
    S.seats = [];
    S.game = null;
    S.phase = 'menu';
    S.summary = false;
    S.lastResult = null;
    S.deal = null;
    S.tribute = null;
    S.selected = [];
    S.auto = false;
    S.autoPending = false;
    S.chatOpen = false;
    S.chatTab = 'emoji';
    S.chatT0 = 0;
    S.testMenu = false;
    S.testDeck = false;
    P.markDirty();
  }

  function netCreate() {
    S.leaving = false;
    S.reconnectTries = 0;
    var ready = netJoinServer();
    var msg = { t: 'create', name: myName(), rounds: S.rounds, cfg: S.roomCfg };
    if (ready) NET.send(msg); else S.pending = msg;
    S.lobby.err = '正在连接…';
    P.markDirty();
  }

  function netJoin(code) {
    if (!code || code.length !== 4) { S.lobby.err = '房间号是 4 位数字'; P.markDirty(); return; }
    S.leaving = false;
    S.reconnectTries = 0;
    var ready = netJoinServer();
    var msg = { t: 'join', name: myName(), room: code };
    if (ready) NET.send(msg); else S.pending = msg;
    S.lobby.err = '正在连接…';
    P.markDirty();
  }

  // 快速开局：服务端一次完成「建房 → 补 3 个机器人 → 发牌」，不经过等待房
  function netQuick() {
    S.mode = 'online';
    S.phase = 'lobby';
    S.waitRoom = false;
    S.leaving = false;
    S.reconnectTries = 0;
    S.lobby = { kind: 'quick', busy: true, err: '', url: NET.defaultUrl(), code: '' };
    bindNet();
    var ready = netJoinServer();
    var msg = {
      t: 'quick',
      name: myName(),
      rounds: 8,
      cfg: { tributeTier: 'heavy', turnSeconds: 20, teamHint: 'none', testTribute: false }
    };
    if (ready) NET.send(msg); else S.pending = msg;
    P.markDirty();
  }

  function onNetMessage(m) {
    if (m.t === 'joined') {
      var quickJoin = !!(S.lobby && S.lobby.kind === 'quick');
      S.room = m.room;
      // 快速局在 joined 之后马上发 state：保留准备面板直到 state 到达，避免闪一帧主菜单
      S.lobby = quickJoin ? { kind: 'quick', busy: true, err: '', url: NET.defaultUrl(), code: '' } : null;
      if (m.key) {
        S.rejoin = { room: m.room, key: m.key };
        storageSet('gx13_rejoin', S.rejoin);
      }
      S.chatSeenTs = 0;
      S.reconnecting = false;
      S.reconnectTries = 0;
      S.leaving = false;
      toast(quickJoin ? '机器人已入座，开始发牌' : (m.rejoin ? '已回到房间 ' + m.room : '已进入房间 ' + m.room));
      P.markDirty();
      return;
    }
    if (m.t === 'superseded') {
      // 同一把重连 key 在另一处登录：服务端接管了座位，这里不能再自动重连，否则两边互踢
      S.reconnecting = false;
      S.reconnectTries = 0;
      S.rejoin = null;
      try { storageSet('gx13_rejoin', null); } catch (e) {}
      if (S.mode === 'online') {
        S.leaving = true;      // 房间映射已被服务端摘掉，returnHome 不必再发 leave
        returnHome();
        openLobby();
        S.lobby.err = m.msg || '座位已在另一处登录';
        toast('座位已在另一处登录，本机已退出房间');
      }
      P.markDirty();
      return;
    }
    if (m.t === 'err') {
      // 重连被拒（座位已被 AI 接管/房间已解散）：别把玩家晾在过期的牌桌上，
      // 清掉重连凭据回联机大厅，重新建房或进房
      if (S.reconnecting && S.rejoin) {
        S.reconnecting = false;
        S.reconnectTries = 0;
        S.rejoin = null;
        try { storageSet('gx13_rejoin', null); } catch (e) {}
        if (S.mode === 'online') {
          S.leaving = true;      // 座位已失效，服务端没有可退的房间映射
          returnHome();
          openLobby();
          S.lobby.err = m.msg || '座位已失效';
          toast('座位已失效，请重新进房');
          P.markDirty();
          return;
        }
      }
      if (S.lobby) { S.lobby.busy = false; S.lobby.err = m.msg; }
      else toast(m.msg);
      P.markDirty();
      return;
    }
    if (m.t === 'roomClosed') {
      // 房主主动解散房间：自己也回主界面；其他被解散的玩家回大厅另找房间
      var wasLeaving = !!S.leaving;
      returnHome();
      if (!wasLeaving) {
        openLobby();
        S.lobby.err = m.msg || '';
      }
      toast(m.msg || '房间已解散');
      return;
    }
    if (m.t === 'state') { applyView(m); return; }  }

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
    S.lobby = null;
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
    // 发言：服务端时间戳可能与手机不同步，这里换成客户端时间轴
    // 新到的条目给「现在」，历史条目压到 8 秒前（只进面板、不冒气泡）
    var seenTs = S.chatSeenTs || 0;
    var pend = (S.chats || []).filter(function (c) {
      return c.pending && Date.now() - (c.ts || 0) < 8000;
    });
    S.chats = (v.chat || []).map(function (c) {
      var fresh = (c.ts || 0) > seenTs;
      return { rel: c.rel, kind: c.kind, text: c.text, ts: fresh ? Date.now() : Date.now() - 8000 };
    });
    // 服务端还没回显的自己那句，先补上；已被回显的则去掉 pending，避免重复
    pend.forEach(function (p) {
      var dup = S.chats.some(function (c) {
        return c.rel === 0 && c.kind === p.kind && c.text === p.text;
      });
      if (!dup) S.chats.push(p);
    });
    S.chatSeenTs = (v.chat || []).reduce(function (m, c) { return Math.max(m, c.ts || 0); }, seenTs);
    // 自己在桌上的座位名跟着本地昵称走，免得服务端还没回包时显示旧名字
    if (S.myName && S.seats[0]) S.seats[0].name = S.myName;

    // 记录旧 revealedCards 长度：state 更新后对比增量，触发身份特效（♠3/♠A 亮出）
    var prevRc = (S.game && S.game.players) ? S.game.players.map(function (pl) {
      return (pl.revealedCards || []).length;
    }) : null;

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
    if (S.phase !== 'play' && S.phase !== 'tribute') {
      S.chatOpen = false;
      S.chatTab = 'emoji';
      S.chatT0 = 0;
    }

    var plays = S.game ? S.game.trickPlays.length : 0;
    if (plays > (S.prevPlays || 0)) {
      var last = S.game.trickPlays[plays - 1];
      fxPlayed(S.game, last.player);
    }
    S.prevPlays = v.phase === 'play' ? plays : 0;
    // 线上复盘：直接用服务端出牌序列（过牌不记录）
    if (S.game && S.game.trickPlays.length) {
      S.replay = S.game.trickPlays.map(function (pl) {
        return { seat: pl.player, cards: pl.cards, pass: false };
      }).slice(-240);
    }

    // 身份牌增量：新亮出的 ♠3/♠A（revealedCards 只记录身份牌点数）触发同组 fx 字段
    if (prevRc && S.game) {
      for (var pi = 0; pi < S.game.players.length; pi++) {
        var nrc = S.game.players[pi].revealedCards || [];
        for (var di = (prevRc[pi] || 0); di < nrc.length; di++) {
          var rv = nrc[di];
          if (rv && typeof rv === 'object') rv = rv.r; // 兼容 {r:n} 形态
          if (rv === 3 || rv === 14) fxIdentitySet(pi, rv);
        }
      }
    }
    fxLoneCheck(); // online 对比增量后：revealedCards 齐 ♠3+♠A → 独食揭示（幂等守卫）

    if (v.phase === 'play') {
      S.hint = v.turn === 0 ? (v.combo ? '轮到你，压不过可过牌' : '你起手，必须出牌') : SEAT_NAMES[v.turn] + ' 出牌中';
      if (v.deadline) startNetTimer(v.deadline);
      else clearTurnTimer();
      if (v.turn === 0) armAuto();
    } else {
      clearTurnTimer();
      if (v.phase !== 'tribute') S.hint = '';
    }
    // 别人发言时给一声轻「叮」（新到的条目 ts≈现在，历史条目被压到 8 秒前）
    if (S.chats.length) {
      var nc = S.chats[S.chats.length - 1];
      if (nc.ts > (S.lastChatTs || 0) && Date.now() - nc.ts < 2000) {
        S.lastChatTs = nc.ts;
        if (nc.rel !== 0) SFX.play('chat');
      }
    }

    if (v.phase === 'tribute' && v.tribute) {
      var T = v.tribute;
      // 配额映射：服务端 pulledFrom 已统一为相对座位键（含身份牌亮出后的重抽），
      // 只有带 pulledFromRel 标记才直接用；老服务端/云函数（绝对座位键或没有该字段）退回按 draws 计
      var drawnFrom = {};
      if (T.pulledFromRel && T.pulledFrom) {
        Object.keys(T.pulledFrom).forEach(function (k) { drawnFrom[k] = T.pulledFrom[k]; });
      } else {
        (T.draws || []).forEach(function (d) { drawnFrom[d.from] = (drawnFrom[d.from] || 0) + 1; });
      }
      var pairQuota = (typeof T.pairQuota === 'number') ? T.pairQuota : null;
      var pull = T.pull || null;
      if (pull && pull.rows && pairQuota != null) {
        pull.rows.forEach(function (r) { r.cap = pairQuota; r.got = drawnFrom[r.rel] || 0; });
      }
      S.tribute = {
        plan: { count: T.count || 0, winnerRanks: T.winnerRanks || [], winners: T.winnersRel || [], losers: T.canDraw || [], skip: false },
        draws: T.draws || [],
        reveals: T.reveals || [],
        log: (T.log || []).slice(-6),
        shares: [],
        need: T.need || 0,
        drawNeed: T.drawNeed || 0,
        stage: T.stage || 'draw',
        canDraw: T.canDraw || [],
        pull: pull,
        pairQuota: pairQuota,
        drawnFrom: drawnFrom,
        // 联机还贡：服务端按 need 下发剩余张数，没有 retQueue；补一个最小 ret 结构给
        // retRemaining()/状态条用（此前 retRemaining 恒 0，勾牌直接被“只剩 0 张”拦住）
        ret: T.stage === 'return' ? (T.ret || { total: T.need || 0, idx: 0, curFrom: -1 }) : (T.ret || null),
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
        // 联机结算也只记一次
        var sk = S.room + '#' + v.round;
        if (S.lastSettleKey !== sk) {
          S.lastSettleKey = sk;
          var rs = recordResult(R.scores[0] || 0);
          S.streakNow = rs.streak;
          if (S.vibOn) P.haptic('light');
        }
      }
    } else if (v.phase !== 'settle') {
      S.lastResult = null;
      S.fx.settleT0 = 0;
    }

    S.selected = [];
    P.markDirty();
  }

  // ---------- 试玩/预览开局（正式产品不提供入口，只保留给无头测试与 demo）----------
  function newMatch() {
    S.mode = 'solo';
    clearTurnTimer();
    clearTributeTimer();
    SFX.flush();
    if (dealTick) { clearInterval(dealTick); dealTick = null; }
    S.deal = null;
    S.fx = {};
    S.scores = [0, 0, 0, 0];
    S.round = 0;
    S.lastResult = null;
    S.summary = false;
    S.chatOpen = false;
    S.chatTab = 'emoji';
    S.chatT0 = 0;
    S.phase = 'idle';
    S.game = null;
    S.resetPending = 0;
    S.replay = [];
    startRound();
  }

  // ---------- 测试手牌（调试用） ----------
  // 主视角固定 13 张：4×3、4×A、4×2 + ♦4；其余 39 张按原局随机分给三家
  function specialHand() {
    var out = [];
    [3, 14, 2].forEach(function (r) {
      for (var s = 0; s < 4; s++) out.push({ r: r, s: s });
    });
    out.push({ r: 4, s: 0 });
    return out;
  }

  // 把特殊 13 张换到真人手里：整副 52 张先归池，捞出特殊 13 张给真人，其余 39 张重分三家
  function applyTestDeck(g) {
    if (!g || !g.players || g.players.length < 4) return;
    var spec = specialHand();
    var pool = [];
    for (var p = 0; p < 4; p++) {
      pool = pool.concat(g.players[p].hand);
      g.players[p].hand = [];
    }
    var specCards = [], rest = [];
    pool.forEach(function (c) {
      var isSpec = false;
      for (var i = 0; i < spec.length; i++) {
        if (spec[i].r === c.r && spec[i].s === c.s) { isSpec = true; break; }
      }
      if (isSpec) specCards.push(c); else rest.push(c);
    });
    g.players[0].hand = specCards.length === 13
      ? specCards
      : spec.map(function (c) { return { r: c.r, s: c.s }; });
    for (var q = 1; q < 4; q++) g.players[q].hand = rest.splice(0, 13);
    sortHand(g.players[0].hand);
    // 换牌后 ♠3/♠A 归属变了，阵营必须按新牌重算，否则独食/组队判定还是换牌前的旧结果
    g.camp = GX.Camp.analyze(g.players.map(function (x) { return x.hand; }));
    // 先手按方块4 定：♦4 已换到主视角，回合也要同步给主视角，否则原 ♦4 持有者仍先出
    g.turn = 0;
    g.combo = null;
    g.comboOwner = -1;
    g.lastPlayer = -1;
    g.trickPlays = [];
    g.firstPlayPending = false;
  }

  function startRound() {
    clearTurnTimer();
    clearTributeTimer();
    S.round++;
    S.selected = [];
    S.hint = '';
    S.hintIdx = 0;
    S.replay = [];
    S.summary = false;
    S.fx = {};
    S.tribute = null;
    S.busy = false;
    var seed = Math.floor(Math.random() * 4e9);
    S.game = GX.Table.createRound({ seed: seed, config: S.cfg });
    // 测试模式：只固定主视角这一手牌；进贡、结算、计分全走正常规则（赢了照样抽三家贡）
    if (S.testDeck) applyTestDeck(S.game);

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
          humanDrawn: [],
          pairQuota: plan.pairQuota || null,
          drawnFrom: {},
          returned: []
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
    T.drawnFrom = T.drawnFrom || {};   // 演示入口/旧状态可能缺该字段
    if (T.plan && T.plan.losers && T.plan.losers.indexOf(p) < 0) { toast('只能从败方手里抽'); return; }
    if (S.mode === 'online') {
      if (!T.myTurn) { toast('还没轮到你抽牌'); return; }
      if ((T.canDraw || []).indexOf(p) < 0) { toast('这个人已经抽过了'); return; }
      // 独食抽牌方向每败方有配额：UI 先行拦截，免得发过去被服务端回「这家已抽满」
      var loneDraw = !!(T.pairQuota && T.plan && T.plan.winners && T.plan.winners.length === 1);
      if (loneDraw && (T.drawnFrom[p] || 0) >= T.pairQuota) { toast('这家已抽满，换一家'); return; }
      // 服务端协议是 draw（按座位随机抽一张）；此前这里发 drawPick，服务端没有该类型，
      // 真人抽牌请求被静默丢弃，只能等超时由 AI 代抽
      NET.send({ t: 'draw', seatRel: p });
      return;
    }
    if (!T.humanIsWinner) return;
    if ((T.humanDrawn || []).length >= (T.need || 0)) return;
    // lone = 独食抽牌方向（独食为唯一胜方，多行摊开）；每败方上限拦截只挂在这个方向，
    // 被抽方向（losers.length===1）drawnFrom 是三家合计，不能用来拦当前真人胜方
    var lone = !!(T.pairQuota && T.plan && T.plan.winners && T.plan.winners.length === 1);
    if (lone && (T.drawnFrom[p] || 0) >= T.pairQuota) { toast('这家已抽满，换一家'); return; }
    T.stage = 'pull';
    var losersAll = lone ? ((T.plan && T.plan.losers) || [p]) : [p];
    var rows = losersAll.map(function (r) {
      return { rel: r, n: S.game.players[r].hand.length, cap: T.pairQuota, got: T.drawnFrom[r] || 0 };
    });
    var perRow = lone ? T.pairQuota : T.need;
    T.pull = { rows: rows, done: 0, total: perRow * rows.length, count: T.need, roundStart: (T.draws || []).length };
    S.hint = '点牌背抽一张';
    P.markDirty();
    return;
  }

  // 摊牌后点某家第 idx 张：抽走一张
  function pullOne(rel, idx) {
    var T = S.tribute;
    if (!T || T.stage !== 'pull' || !T.pull) return;
    T.drawnFrom = T.drawnFrom || {};
    if (S.mode === 'online') { NET.send({ t: 'draw', seatRel: rel }); return; }
    var p = rel;
    // 每败方上限仅适用独食抽牌方向（winners.length===1）；被抽方向（losers.length===1）
    // 配额按每位胜方计，drawnFrom[lone] 是跨胜方合计，此处若误拦真人会与 aiJobPending 死锁
    var perLoserCap = !!(T.pairQuota && T.plan && T.plan.winners && T.plan.winners.length === 1);
    if (perLoserCap && (T.drawnFrom[p] || 0) >= T.pairQuota) { toast('这家已抽满，换一家'); return; }
    var hand = S.game.players[p].hand;
    if (!hand.length) return;
    var k = Math.max(0, Math.min(idx, hand.length - 1));
    var c = hand[k];
    if (GX.Tribute.isIdentity(c)) {
      // 同一张身份牌重复点到：只亮一次，避免徽标/日志重复
      var already = (T.reveals || []).some(function (r) {
        return r.owner === p && r.card && r.card.r === c.r && r.card.s === c.s;
      });
      if (!already) {
        T.reveals.push({ owner: p, card: c });
        T.log.push({ text: SEAT_NAMES[p] + ' 的 ' + suitRank(c) + ' 是身份牌，亮出归还后重抽', kind: 'warn' });
      }
      S.game.players[p].revealed = true;
      var rc0 = S.game.players[p].revealedCards = S.game.players[p].revealedCards || [];
      if (rc0.indexOf(c.r) < 0) rc0.push(c.r);
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
    T.drawnFrom[p] = (T.drawnFrom[p] || 0) + 1;
    (T.pull.rows || []).forEach(function (r) { if (r.rel === p) { r.n = hand.length; r.got = T.drawnFrom[p]; } });
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
    if (GX.Tribute.isIdentity(c)) { toast('身份牌不能还贡'); return; }
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
    T.returned = T.returned || [];   // 防旧状态/联机映射缺字段：先记录再推进，避免中途抛异常导致还贡卡死
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
    if (S.mode === 'online') {
      // 服务端 return 是批次接口：必须一次把 T.need 张全还上，少还/多还都会被拒
      var need = T.need || 0;
      if (!cards.length || cards.length !== need) { toast('要一次还 ' + need + ' 张'); return; }
      S.selected = [];
      // 此前发的是 retOne，服务端只认 return → 真人还贡永远不生效，20 秒后 AI 代还
      NET.send({ t: 'return', cards: cards });
      P.markDirty();
      return;
    }
    S.selected = [];
    cards.forEach(function (c) { returnOneLocal(c); });
    SFX.play('ret');
    S.fx.retT0 = Date.now();
    if (T.retIdx >= (T.retQueue || []).length) {
      T.humanRetDone = true;
      // 独食被抽方向：真人抽满还贡后，后面还有 AI 胜方要抽，回到 draw 让调度继续
      var interleave = !!(T.pairQuota && T.plan && T.plan.losers && T.plan.losers.length === 1);
      if (interleave && aiJobPending(T)) {
        T.stage = 'draw';
        P.markDirty();
        tributeSchedule(AUTO ? 60 : 700);
        return;
      }
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
    // 独食被抽方向（三家抽独食）须逐家交错：当前胜方抽满并还贡后才推进下一位
    var interleave = !!(T.pairQuota && T.plan && T.plan.losers && T.plan.losers.length === 1);
    for (var i = 0; i < T.plan.winners.length; i++) {
      var w = T.plan.winners[i];
      if (w === 0 && T.humanIsWinner) {
        if (interleave && !T.humanRetDone) return null;   // 等真人抽满还贡再推进
        continue;
      }
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
    var targets = GX.Tribute.freeLosers(plan, T.drawnFrom);
    if (!targets.length) {
      // 独食被抽方向（三家抽独食）：配额按每位胜方计，单个败方被三家
      // 合计抽 pairQuota*winners.length 张，此时按该胜方自身 counts/shares 继续
      if (plan.pairQuota && plan.losers.length === 1 && (T.counts[wi] || 0) < T.shares[wi]) {
        targets = plan.losers.slice();
      } else {
        T.counts[wi] = T.shares[wi];   // 目标已全部抽满，视为该胜方完成
        return;
      }
    }
    var target = targets[Math.floor(Math.random() * targets.length)];
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
      T.drawnFrom[target] = (T.drawnFrom[target] || 0) + 1;
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
      T.stage = (T.humanIsWinner && !T.humanRetDone) ? 'return' : 'done';
      if (T.humanIsWinner && !T.humanRetDone) S.hint = '选 ' + T.need + ' 张还贡';
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
    var pending = false;
    if (lead < 0) {
      // 抽牌记录为空（不该发生）：退回 ♦4 先出，不能把 turn 设成 -1 让整桌卡死
      lead = 0;
      for (var q = 0; q < 4; q++) {
        if (S.game.players[q].hand.some(function (c) { return c.r === 4 && c.s === 0; })) { lead = q; break; }
      }
      pending = true;
    }
    S.game.turn = lead;
    S.game.firstPlayPending = pending;
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
      S.chatOpen = false;
      S.chatTab = 'emoji';
      S.chatT0 = 0;
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

  // 弹层打开时吞掉下层点击；发言是右侧非模态浮层，不在这里拦截
  function modalBlocked(act) {
    if (S.ask) return !(act === 'askYes' || act === 'askNo');
    if (S.guideOpen) return !/^guide/.test(act);
    if (S.statsOpen) return act !== 'statsClose';
    if (S.replayOpen) return act !== 'replayClose';
    if (S.toolsOpen) {
      return !(act === 'toolsClose' || act === 'stats' || act === 'replay' || act === 'guide' ||
        act === 'share' || act === 'music' || act === 'vib' || act === 'skin' || act === 'record');
    }
    if (S.pauseOpen) {
      return !(act === 'pauseClose' || act === 'exitToMenu' || act === 'dissolve' || act === 'auto' ||
        act === 'record' || act === 'stats' || act === 'replay' || act === 'guide' || act === 'share' ||
        act === 'music' || act === 'vib' || act === 'skin');
    }
    return false;
  }

  function onTap(x, y) {
    SFX.unlock();
    if (S.musicOn && !SFX.musicIsOn()) SFX.music(true);
    if (S.phase === 'deal') {
      if (S.mode === 'online') { S.deal = null; P.markDirty(); return; }
      finishDeal();
      return;
    }
    var hits = S.hits;
    for (var i = hits.length - 1; i >= 0; i--) {
      var h = hits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        if (modalBlocked(h.act)) return;
        if (h.act === 'chatPanel') return; // 点面板空白只挡住下面的牌，不发提示音
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
    if (h.act === 'netOpen') { openLobby(); return; }
    if (h.act === 'netQuick' || h.act === 'netQuickRetry') { netQuick(); return; }
    if (h.act === 'netQuickCancel') { S.leaving = true; returnHome(); return; }
    if (h.act === 'netCreate') { netCreate(); return; }
    if (h.act === 'netConfig') {
      if (NET.isCloud) { toast('当前走微信云开发，不需要服务器地址'); return; }
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
    if (h.act === 'netServer') {
      if (NET.isCloud) { toast('当前走微信云开发，不需要服务器地址'); return; }
      var wasQuick = S.lobby && S.lobby.kind === 'quick';
      P.askText('联机服务器地址（ws:// 或 wss://）', NET.defaultUrl(), 80, function (v) {
        var s = String(v || '').trim();
        if (!s) return;
        try { if (typeof wx !== 'undefined' && wx.setStorageSync) wx.setStorageSync('gx13_server', s); } catch (e) {}
        try { if (typeof localStorage !== 'undefined') localStorage.setItem('gx13_server', s); } catch (e) {}
        if (wasQuick) {
          netQuick();
        } else {
          S.lobby = { kind: 'entry', url: s, err: '', code: '' };
          P.markDirty();
        }
        toast('服务器已改为 ' + s);
      });
      return;
    }
    if (h.act === 'netBack') { S.leaving = true; returnHome(); return; }
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
    if (h.act === 'netLeave') { returnHome(); return; }
    if (h.act === 'dissolveWait') { S.ask = { kind: 'dissolve' }; P.markDirty(); return; }
    if (h.act === 'netRename') { askName(); return; }
    if (h.act === 'chatOpen') {
      S.chatOpen = !S.chatOpen;
      S.chatT0 = S.chatOpen ? Date.now() : 0;
      if (S.chatOpen && !S.chatTab) S.chatTab = 'emoji';
      P.markDirty();
      return;
    }
    if (h.act === 'chatClose') { S.chatOpen = false; S.chatT0 = 0; P.markDirty(); return; }
    if (h.act === 'chatTabEmoji') { S.chatTab = 'emoji'; P.markDirty(); return; }
    if (h.act === 'chatTabPhrase') { S.chatTab = 'phrase'; P.markDirty(); return; }
    if (h.act === 'chatEmoji') { sendChat('emoji', h.text); return; }
    if (h.act === 'chatText') { sendChat('text', h.text); return; }
    if (h.act === 'chatType') { typeChat(); return; }
    if (h.act === 'card') { tapCard(h.i); return; }
    if (h.act === 'auto') {
      if (S.auto) { cancelAuto(); return; }
      S.auto = true;
      toast('托管已开：轮到你自动挑最小牌');
      armAuto();
      P.markDirty();
      return;
    }
    if (h.act === 'pause') { S.pauseOpen = true; S.toolsOpen = false; P.markDirty(); return; }
    if (h.act === 'pauseClose') { S.pauseOpen = false; P.markDirty(); return; }
    if (h.act === 'exitToMenu') { S.pauseOpen = false; S.ask = { kind: 'exit' }; P.markDirty(); return; }
    if (h.act === 'exitHome') {
      // 点「主界面」先问一句，不直接退
      S.pauseOpen = false;
      S.ask = { kind: 'exit' };
      P.markDirty();
      return;
    }
    if (h.act === 'dissolve') {
      S.pauseOpen = false;
      S.ask = { kind: 'dissolve' };
      P.markDirty();
      return;
    }
    if (h.act === 'askNo') { S.ask = null; P.markDirty(); return; }
    if (h.act === 'askYes') {
      var kind = S.ask ? S.ask.kind : 'exit';
      S.ask = null;
      if (kind === 'dissolve') {
        if (S.mode === 'online') {
          S.leaving = true;       // 房主自己退房，不再等 roomClosed 回大厅
          NET.send({ t: 'dissolve' });
          setTimeout(returnHome, 200);   // 让 dissolve 先发出去，再关连接
        } else {
          returnHome();
        }
        toast('房间已解散');
        return;
      }
      if (S.mode === 'online') {
        // 让服务端先把座位转托管，再断开本局连接回到主界面
        setTimeout(function () { doExitHome(); }, 180);
        toast('已退出，座位由机器人托管');
        return;
      }
      doExitHome();
      return;
    }
    if (h.act === 'tools') {
      S.toolsOpen = !S.toolsOpen;
      if (S.toolsOpen) { S.pauseOpen = false; S.recordOpen = false; }
      P.markDirty();
      return;
    }
    if (h.act === 'toolsClose') { S.toolsOpen = false; P.markDirty(); return; }
    if (h.act === 'stats') { S.statsOpen = true; S.toolsOpen = false; S.pauseOpen = false; S.stats = loadStats(); P.markDirty(); return; }
    if (h.act === 'statsClose') { S.statsOpen = false; P.markDirty(); return; }
    if (h.act === 'record') {
      S.recordOpen = !S.recordOpen;
      S.toolsOpen = false;
      S.pauseOpen = false;
      if (S.recordOpen) toast('记牌器已展开：手牌下方显示各点数剩余');
      P.markDirty();
      return;
    }
    if (h.act === 'recordClose') { S.recordOpen = false; P.markDirty(); return; }
    if (h.act === 'replay') { S.replayOpen = true; S.pauseOpen = false; P.markDirty(); return; }
    if (h.act === 'replayClose') { S.replayOpen = false; P.markDirty(); return; }
    if (h.act === 'guide') { S.guideOpen = true; S.guidePage = 0; S.pauseOpen = false; P.markDirty(); return; }
    if (h.act === 'guidePrev') { S.guidePage = Math.max(0, (S.guidePage || 0) - 1); P.markDirty(); return; }
    if (h.act === 'guideNext') {
      S.guidePage = Math.min(2, (S.guidePage || 0) + 1);
      P.markDirty();
      return;
    }
    if (h.act === 'guideDone') {
      S.guideOpen = false;
      storageSet(GUIDE_KEY, '1');
      P.markDirty();
      return;
    }
    if (h.act === 'guideClose') {
      S.guideOpen = false;
      storageSet(GUIDE_KEY, '1');
      P.markDirty();
      return;
    }
    if (h.act === 'share') { shareResult(); return; }
    if (h.act === 'music') {
      S.musicOn = SFX.music(!SFX.musicIsOn());
      storageSet('gx13_music', S.musicOn ? '1' : '0');
      toast(S.musicOn ? '背景音乐已开' : '背景音乐已关');
      P.markDirty();
      return;
    }
    if (h.act === 'vib') {
      S.vibOn = !S.vibOn;
      storageSet('gx13_vib', S.vibOn ? '1' : '0');
      if (S.vibOn) P.haptic('light');
      toast(S.vibOn ? '震动已开' : '震动已关');
      P.markDirty();
      return;
    }
    if (h.act === 'skin') {
      S.skin = ((S.skin || 0) + 1) % 3;
      storageSet('gx13_skin', String(S.skin));
      toast('牌背：' + ['经典红', '青竹', '鎏金'][S.skin]);
      P.markDirty();
      return;
    }
    if (h.act === 'play') { doPlay(); return; }
    if (h.act === 'pass') { doPass(); return; }
    if (h.act === 'hint') { doHint(); return; }
    if (h.act === 'drawSeat') { drawFromSeat(h.p); return; }
    if (h.act === 'pullCard') { pullOne(h.p, h.idx); return; }
    if (h.act === 'testTribute') { S.testMenu = false; demoPullTest(); return; }
    if (h.act === 'testMenu') { S.testMenu = !S.testMenu; P.markDirty(); return; }
    if (h.act === 'testHand') {
      // 测试模式：单机新局，主视角固定 4×3 / 4×A / 4×2 + ♦4
      S.testMenu = false;
      S.testDeck = true;
      S.mode = 'solo';
      S.game = null;
      newMatch();
      return;
    }
    if (h.act === 'confirmReturn') { confirmReturn(); return; }
    if (h.act === 'toMenu') {
      // 联机总结页点「回到开始界面」必须真正退房：只改本地 phase 会留下幽灵座位，
      // 房主还占着房，其他人既开不了新局也等不到房主
      if (S.mode === 'online') { returnHome(); return; }
      clearTurnTimer();
      clearTributeTimer();
      S.phase = 'menu';
      S.testMenu = false;
      S.testDeck = false;
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
      if (S.mode === 'online') {
        // 打满局数的总结页：房主点「再来一场」重开同房新一场，其他人等房主
        if (!S.isHost) { toast('等房主再来一场'); return; }
        NET.send({ t: 'next' });
        return;
      }
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
    S.myName = loadName();
    S.chatEmoji = CHAT_EMOJI;
    S.chatPhrases = CHAT_PHRASES;
    // 本地偏好与战绩
    S.vibOn = storageGet('gx13_vib') !== '0';
    var sk = parseInt(storageGet('gx13_skin') || '0', 10);
    S.skin = (sk >= 0 && sk <= 2) ? sk : 0;
    S.musicOn = storageGet('gx13_music') === '1';
    S.stats = loadStats();
    S.guideDone = storageGet(GUIDE_KEY) === '1';
    var isDemo = false;
    try {
      isDemo = /demo=/.test((window.location && window.location.search) || '');
    } catch (e) {}
    // 新手引导不再开局自动弹：只从页头「引导」chip / 更多抽屉手动打开
    // 预览调试开关：?tools=1 / stats=1 / record=1 / replay=1 / guide=1
    try {
      var qs = (window.location && window.location.search) || '';
      if (/tools=1/.test(qs)) S.toolsOpen = true;
      if (/pause=1/.test(qs)) S.pauseOpen = true;
      if (/askExit=1/.test(qs)) S.ask = { kind: 'exit' };
      if (/askDissolve=1/.test(qs)) S.ask = { kind: 'dissolve' };
      if (/stats=1/.test(qs)) { S.statsOpen = true; S.stats = loadStats(); }
      if (/record=1/.test(qs)) S.recordOpen = true;
      if (/guide=1/.test(qs)) { S.guideOpen = true; S.guidePage = 0; }
      var msk = /skin=(\d)/.exec(qs);
      if (msk) S.skin = Math.min(2, Math.max(0, parseInt(msk[1], 10) || 0));
      if (/replay=1/.test(qs) && !S.replay.length) {
        S.replayOpen = true;
        S.replay = [
          { seat: 0, cards: [{ r: 4, s: 0 }, { r: 5, s: 1 }, { r: 6, s: 1 }, { r: 7, s: 2 }, { r: 8, s: 3 }], pass: false },
          { seat: 1, cards: null, pass: true },
          { seat: 2, cards: [{ r: 9, s: 3 }, { r: 10, s: 3 }, { r: 11, s: 3 }, { r: 12, s: 0 }, { r: 13, s: 2 }], pass: false },
          { seat: 3, cards: null, pass: true },
          { seat: 0, cards: null, pass: true },
          { seat: 1, cards: [{ r: 14, s: 3 }, { r: 2, s: 3 }], pass: false },
          { seat: 2, cards: [{ r: 3, s: 2 }], pass: false }
        ];
      }
    } catch (e) {}
    P.bindTap(onTap);
    // 微信被动分享（右上角菜单 / 长按转发）也带战绩文案
    try {
      if (typeof wx !== 'undefined' && wx.onShareAppMessage) {
        if (wx.showShareMenu) wx.showShareMenu({ withShareTicket: false });
        wx.onShareAppMessage(function () { return { title: shareText() }; });
      }
    } catch (e) {}
    if (P.bindMove) P.bindMove(onDrag);
    if (P.bindEnd) P.bindEnd(onDragEnd);
    P.start(draw);
    if (typeof window !== 'undefined') window.__gx = { S: S, P: P, onTap: onTap, SFX: SFX };
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
        /demo=testHand/.test(window.location.search || '')) {
      // 预览/真机用：直接进测试模式（主视角 4×3 / 4×A / 4×2 + ♦4）
      S.testDeck = true;
      S.mode = 'solo';
      newMatch();
      return;
    }
    if (typeof window !== 'undefined' && window.location &&
        /demo=tribute/.test(window.location.search || '')) { demoTribute(); return; }
    if (typeof window !== 'undefined' && window.location &&
        /demo=identity/.test(window.location.search || '')) { demoFx(); return; }
    if (typeof window !== 'undefined' && window.location &&
        /demo=lone/.test(window.location.search || '')) { demoFx(); return; }
    if (typeof window !== 'undefined' && window.location &&
        /demo=fx/.test(window.location.search || '')) { demoFx(); return; }
    if (typeof window !== 'undefined' && window.location &&
        /demo=flight/.test(window.location.search || '')) { demoFlight(); return; }
    if (typeof window !== 'undefined' && window.location &&
        /demo=lobby/.test(window.location.search || '')) { openLobby(); return; }
    if (typeof window !== 'undefined' && window.location &&
        /demo=quickErr/.test(window.location.search || '')) {
      openLobby();
      S.lobby = { kind: 'quick', busy: false, err: '连不上服务器：' + NET.defaultUrl(), url: NET.defaultUrl(), code: '' };
      P.markDirty(); return;
    }
    if (typeof window !== 'undefined' && window.location &&
        /demo=quick/.test(window.location.search || '')) {
      openLobby();
      S.lobby = { kind: 'quick', busy: true, err: '', url: NET.defaultUrl(), code: '' };
      P.markDirty(); return;
    }
    if (typeof window !== 'undefined' && window.location &&
        /demo=cfg/.test(window.location.search || '')) {
      openLobby();
      S.lobby = { kind: 'config', url: NET.defaultUrl(), err: '', code: '' };
      S.mode = 'online'; P.markDirty(); return;
    }
    if (typeof window !== 'undefined' && window.location &&
        /demo=online/.test(window.location.search || '')) { demoOnline(); return; }
    if (typeof window !== 'undefined' && window.location &&
        /demo=keypad/.test(window.location.search || '')) {
      openLobby(); S.lobby = { kind: 'keypad', code: '12', err: '' }; P.markDirty(); return;
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
    var sm = /suit=([0-3])/.exec(window.location.search || '');
    var idm = /demo=identity/.exec(window.location.search || '');
    var lom = /demo=lone/.exec(window.location.search || '');
    newMatch();
    S.fxDemoP = m ? parseFloat(m[1]) : 0.35;
    S.fxDemoKind = km ? km[1] : '';
    // 仅预览用：?demo=lone 冻结独食揭示特效（可叠加 &seat=0..3）
    if (lom) {
      S.fxDemoKind = 'lone';
      var lsm = /seat=([0-3])/.exec(window.location.search || '');
      var lSeat = lsm ? parseInt(lsm[1], 10) : 2;
      S.fx.loneSeat = lSeat;
      // 让该座位同步亮出双身份牌，便于核对朱红边框/「独食」字与脉冲落点
      if (S.game && S.game.players[lSeat]) S.game.players[lSeat].revealedCards = [3, 14];
    }
    // 仅预览用：?demo=identity 冻结身份特效（可叠加 &seat=0..3 &rank=3|14）
    if (idm) {
      S.fxDemoKind = 'identity';
      var stm = /seat=([0-3])/.exec(window.location.search || '');
      var rkm = /rank=(3|14)/.exec(window.location.search || '');
      var dSeat = stm ? parseInt(stm[1], 10) : 2;
      var dRank = rkm ? parseInt(rkm[1], 10) : 3;
      S.fx.identitySeat = dSeat;
      S.fx.identityRank = dRank;
      // 让座位牌同步亮出该身份徽标，便于核对徽标落点吻合
      if (S.game && S.game.players[dSeat]) S.game.players[dSeat].revealedCards = [dRank];
    }
    // 仅预览用：?suit=0..3 给同花着色验证提供该花色 5 张样例牌
    if (sm) S.fx.cards = [5, 7, 9, 11, 13].map(function (r) { return { s: parseInt(sm[1], 10), r: r }; });
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
    // 预览用：&wait=1 冻结在等待开局，核对房间面板（改名/发言入口）
    if (typeof window !== 'undefined' && window.location &&
        /wait=1/.test(window.location.search || '')) {
      S.waitRoom = true;
      S.phase = 'wait';
      S.game = null;
      S.isHost = true;
    }

    // 预览用：&chat=1 直接摊开发言面板并塞几条样例消息
    if (typeof window !== 'undefined' && window.location &&
        /chat=1/.test(window.location.search || '')) {
      S.chatOpen = /bubble=1/.test(window.location.search || '') ? false : true;
      var t0c = Date.now() + 3600000; // 预览专用：时间戳推到未来，保证截图时气泡不过期
      S.chats = [
        { rel: 1, kind: 'text', text: '快点吧', ts: t0c - 6000 },
        { rel: 2, kind: 'emoji', text: '😭', ts: t0c - 3000 },
        { rel: 0, kind: 'text', text: '马上就好', ts: t0c - 800 }
      ];
    }
    // 预览用：&settle=1 停在结算页，核对分享/复盘按钮与连胜文案
    if (typeof window !== 'undefined' && window.location &&
        /settle=1/.test(window.location.search || '')) {
      S.stats = {
        games: 12, wins: 7, losses: 4, draws: 1, streak: 3, bestStreak: 4, best: 96,
        history: [
          { t: Date.now() - 86400000, score: 96, win: 1 },
          { t: Date.now() - 43200000, score: 24, win: 1 },
          { t: Date.now() - 21600000, score: -18, win: -1 },
          { t: Date.now() - 3600000, score: 48, win: 1 },
          { t: Date.now() - 600000, score: 30, win: 1 }
        ],
        top: [
          { score: 96, t: Date.now() - 86400000 },
          { score: 48, t: Date.now() - 3600000 },
          { score: 30, t: Date.now() - 600000 },
          { score: 24, t: Date.now() - 43200000 },
          { score: -18, t: Date.now() - 21600000 }
        ]
      };
      S.scores = [-6, 12, 12, -6];
      S.lastResult = {
        camp: { mode: 'team', lone: -1, teamA: [0, 2], teamB: [1, 3] },
        ranks: [1, 2, 0, 3],
        scores: [30, -12, -12, 6],
        winRanks: [1, 2]
      };
      S.phase = 'settle';
      S.fx.settleT0 = Date.now() - 400;
    }
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
      need: 2, stage: 'draw', canDraw: [1, 3], turnW: 0, picks: [], returned: [], drawnFrom: {},
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
      drawnFrom: {},
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
