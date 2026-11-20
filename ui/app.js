/* 十三张·独食 — 单机牌桌原型（人类坐南家，其余三家为"队友让牌 AI"） */
(function () {
  var GX = window.GX;
  var SEAT_NAMES = ['你', '西家', '北家', '东家'];
  var SEAT_POS = ['south', 'west', 'north', 'east'];
  var BOUND_SEATS = [{ pos: 'west', p: 1 }, { pos: 'north', p: 2 }, { pos: 'east', p: 3 }];
  var SUIT_CHAR = ['♦', '♣', '♥', '♠'];
  var RANK_CHAR = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

  var S = {
    cfg: GX.Rules.resolve(),
    rounds: 8,
    round: 0,
    scores: [0, 0, 0, 0],
    game: null,
    lastResult: null,
    phase: 'idle',
    selected: [],
    hint: '',
    tribute: null,
    log: [],
    busy: false,
    level: 1,                 // 0 新手 / 1 普通 / 2 高手
    timer: { id: null, left: 0 }
  };

  var TURN_SECONDS = 20;

  function el(id) { return document.getElementById(id); }
  function rankText(r) { return RANK_CHAR[r] || String(r); }
  function isRed(c) { return c.s === 2 || c.s === 0; }

  function cardHTML(c, cls) {
    return '<div class="card ' + (isRed(c) ? 'red' : 'black') + ' ' + (cls || '') + '">' +
      '<span class="ct">' + rankText(c.r) + '</span>' +
      '<span class="cs">' + SUIT_CHAR[c.s] + '</span>' +
      '<span class="big">' + SUIT_CHAR[c.s] + '</span></div>';
  }
  function cardBackHTML() { return '<div class="card back"></div>'; }

  function sameCard(a, b) { return a.r === b.r && a.s === b.s; }
  function keyOf(c) { return c.s + '-' + c.r; }

  // ---------- 渲染 ----------
  function render() {
    renderTop();
    renderSeats();
    renderCenter();
    renderHand();
    renderActions();
    renderTribute();
    renderSettle();
  }

  function renderTop() {
    var cfg = S.cfg;
    var summary = [
      cfg.firstCard === 'D4' ? '♦4 先出' : '',
      cfg.rankOrder === '3max' ? '3 最大 4 最小' : 'A 最大 2 最小',
      cfg.scoring === 'rank' ? '名次制' : '剩牌倍数',
      cfg.tributeEnabled ? '进贡·' + (cfg.tributeTier === 'heavy' ? '重贡' : '轻贡') : '无进贡'
    ].filter(Boolean).join(' · ');
    el('roundInfo').textContent = '第 ' + Math.max(1, S.round) + ' / ' + S.rounds + ' 局';
    el('ruleSummary').textContent = summary;
  }

  function renderSeats() {
    var g = S.game;
    for (var p = 0; p < 4; p++) {
      var seat = el('seat-' + SEAT_POS[p]);
      if (!seat) continue;
      var nameEl = seat.querySelector('.seat-name');
      var cntEl = seat.querySelector('.card-count');
      var badges = seat.querySelector('.badges');
      var stack = seat.querySelector('.stack');
      nameEl.textContent = SEAT_NAMES[p];
      var cls = 'seat ' + SEAT_POS[p];
      var scoreEl = seat.querySelector('.seat-score');
      if (scoreEl) scoreEl.textContent = (S.scores[p] > 0 ? '+' : '') + S.scores[p];

      if (g) {
        var count = g.players[p].hand.length;
        cntEl.textContent = count + ' 张';
        cls += count === 0 ? ' out' : '';
        if (g.turn === p && S.phase === 'play') cls += ' active';
        var rc = (g.players[p].revealedCards || []);
        var badgeHTML = '';
        // 打出一张身份牌，就在该座位旁边标一张；两张都出了再标"独食"
        rc.forEach(function (r) {
          badgeHTML += '<span class="badge id">' + (r === 3 ? '♠3' : '♠A') + '</span>';
        });
        if (rc.indexOf(3) >= 0 && rc.indexOf(14) >= 0) badgeHTML += '<span class="badge lone">独食</span>';
        badges.innerHTML = badgeHTML;

        var stackHTML = '';
        var show = Math.min(count, 7);
        for (var i = 0; i < show; i++) stackHTML += cardBackHTML();
        if (stack) stack.innerHTML = stackHTML;
      } else {
        cntEl.textContent = '—';
        badges.innerHTML = '';
        if (stack) stack.innerHTML = '';
      }
      seat.className = cls;
    }
  }

  function renderCenter() {
    var g = S.game;
    var center = el('centerCards');
    var label = el('centerLabel');
    if (!g) { center.innerHTML = ''; label.textContent = '点「开始」发牌'; return; }

    var plays = g.trickPlays || [];

    // 本轮还没人出牌
    if (!plays.length) {
      center.innerHTML = '';
      label.textContent = g.turn >= 0 && S.phase === 'play'
        ? (SEAT_NAMES[g.turn] + ' 起手')
        : '';
      return;
    }

    // 本轮所有出牌全部亮出来（最新的在最后，高亮）
    // 手数多时自动缩牌，保证一轮始终排成一行，不折行压到座位
    var size = plays.length >= 10 ? 'tiny' : (plays.length >= 7 ? 'small' : 'mid');
    center.className = 'center-cards' + (plays.length >= 7 ? ' dense' : '');
    center.innerHTML = plays.map(function (p, i) {
      var isTop = i === plays.length - 1;
      var sorted = p.cards.slice().sort(function (a, b) {
        return (GX.Rules.rankVal(b.r, S.cfg.rankOrder) - GX.Rules.rankVal(a.r, S.cfg.rankOrder)) || (b.s - a.s);
      });
      return '<div class="play-group' + (isTop ? ' top' : '') + '">' +
        '<div class="play-owner">' + SEAT_NAMES[p.player] + '</div>' +
        '<div class="play-cards">' + sorted.map(function (c) {
          // 身份牌只在牌面上做个记号，和普通出牌一样摆在桌上，不额外公布什么
          var isId = GX.Tribute.isIdentity(c);
          return (isId ? '<span class="id-mark">' : '') + cardHTML(c, size) + (isId ? '</span>' : '');
        }).join('') + '</div>' +
        '<div class="play-kind">' + GX.Hand.kindLabel(p.combo.kind) + '</div>' +
        '</div>';
    }).join('');

    var passedNames = Object.keys(g.passes || {}).filter(function (k) { return g.passes[k]; })
      .map(function (k) { return SEAT_NAMES[Number(k)]; });
    var topPlay = plays[plays.length - 1];
    label.textContent = SEAT_NAMES[topPlay.player] + ' · ' + GX.Hand.kindLabel(topPlay.combo.kind) +
      ' · 本轮 ' + plays.length + ' 手' +
      (passedNames.length ? ' · 已过：' + passedNames.join('、') : '');
  }

  function renderHand() {
    var g = S.game;
    var hand = el('hand');
    var tip = el('handTip');
    if (!g) { hand.innerHTML = ''; tip.textContent = ''; return; }
    var mine = g.players[0].hand.slice().sort(function (a, b) {
      return (GX.Rules.rankVal(b.r, S.cfg.rankOrder) - GX.Rules.rankVal(a.r, S.cfg.rankOrder)) || (b.s - a.s);
    });
    g.players[0].hand = mine;
    hand.innerHTML = mine.map(function (c) {
      var sel = S.selected.some(function (s) { return keyOf(s) === keyOf(c); });
      return '<div class="hand-card' + (sel ? ' sel' : '') + '" data-card="' + keyOf(c) + '">' +
        cardHTML(c) + '</div>';
    }).join('');
    tip.textContent = '剩 ' + mine.length + ' 张';
  }

  function renderActions() {
    var g = S.game;
    var can = S.phase === 'play' && g && !g.over && g.turn === 0;
    el('btnPlay').disabled = !can || S.busy;
    el('btnPass').disabled = !can || !g || !g.combo || S.busy;
    el('btnHint').disabled = !can || S.busy;
    el('hint').textContent = S.hint || (can ? (g.combo ? '选牌压过桌面，或过牌' : '起手：选任意合法牌型') : '');
    if (can && !S.busy) { if (!S.timer.id) startTurnTimer(); }
    else clearTurnTimer();
  }

  // ---------- 出牌计时（每步 20 秒，超时自动行动） ----------
  function paintTimer() {
    var t = el('turnTimer');
    if (!t) return;
    if (!S.timer.id) { t.textContent = ''; t.className = 'timer'; return; }
    t.textContent = S.timer.left + 's';
    t.className = 'timer' + (S.timer.left <= 5 ? ' urgent' : '');
  }

  function clearTurnTimer() {
    if (S.timer.id) { clearInterval(S.timer.id); S.timer.id = null; }
    paintTimer();
  }

  function startTurnTimer() {
    clearTurnTimer();
    if (S.phase !== 'play' || !S.game || S.game.over || S.game.turn !== 0) return;
    S.timer.left = TURN_SECONDS;
    S.timer.id = setInterval(function () {
      S.timer.left--;
      if (S.timer.left <= 0) {
        clearTurnTimer();
        onTimeout();
        return;
      }
      paintTimer();
    }, 1000);
    paintTimer();
  }

  // 超时：有桌面就过牌；轮到自己起手（不能过）就自动出最小合法牌
  function onTimeout() {
    var g = S.game;
    if (!g || g.over || S.phase !== 'play' || g.turn !== 0) return;
    S.selected = [];
    if (g.combo) {
      if (GX.Table.pass(g, 0) === null) {
        S.hint = '超时，已自动过牌';
        render();
        scheduleAI();
        return;
      }
    }
    var cands = GX.Moves.candidates(g.players[0].hand, S.cfg);
    var ok = cands.filter(function (c) { return GX.Table.validate(g, 0, c.cards) === null; });
    if (ok.length) {
      var pick = GX.Moves.lowest(ok);
      GX.Table.play(g, 0, pick.cards);
      S.hint = '超时，已自动出最小合法牌';
      render();
      maybeFinishRound();
      scheduleAI();
      return;
    }
    S.hint = '超时';
    render();
  }

  // ---------- 交互：出牌 ----------
  function onHandClick(ev) {
    var target = ev.target.closest('.hand-card');
    if (!target) return;
    if (S.phase !== 'tribute' && S.phase !== 'play') return;
    var k = target.dataset.card;
    var c = S.game.players[0].hand.filter(function (x) { return keyOf(x) === k; })[0];
    if (!c) return;
    var idx = S.selected.findIndex(function (s) { return keyOf(s) === k; });
    if (idx >= 0) S.selected.splice(idx, 1);
    else S.selected.push(c);
    S.hint = '';
    if (S.phase === 'tribute') updateTributeReturn();
    render();
  }

  function currentSelection() { return S.selected.slice(); }

  function doPlay() {
    var g = S.game;
    var cards = currentSelection();
    if (!cards.length) { S.hint = '先选牌'; render(); return; }
    var err = GX.Table.validate(g, 0, cards);
    if (err) { S.hint = explain(err); render(); return; }
    GX.Table.play(g, 0, cards);
    S.selected = [];
    S.hint = '';
    render();
    maybeFinishRound();
    scheduleAI();
  }

  function doPass() {
    var g = S.game;
    var err = GX.Table.pass(g, 0);
    if (err) { S.hint = explain(err); render(); return; }
    S.selected = [];
    render();
    scheduleAI();
  }

  function doHint() {
    var g = S.game;
    if (!g || g.turn !== 0) return;
    var cands = GX.Moves.candidates(g.players[0].hand, S.cfg);
    var ok = cands.filter(function (c) { return GX.Table.validate(g, 0, c.cards) === null; });
    if (!ok.length) { S.hint = g.combo ? '这手压不过，只能过牌' : '没有合法牌型'; render(); return; }
    var pick = g.combo
      ? GX.Moves.lowest(ok.filter(function (c) { return GX.Hand.compare(c.combo, g.combo) > 0; }))
      : GX.Moves.lowest(ok);
    if (!pick) { S.hint = '压不过'; render(); return; }
    S.selected = pick.cards.slice();
    S.hint = '提示：' + GX.Hand.kindLabel(pick.combo.kind);
    render();
  }

  function explain(code) {
    var map = {
      'not-turn': '还没轮到你',
      'already-passed': '本轮你已经过牌，不能再出',
      'not-in-hand': '手牌里没有这张',
      'bad-combo': '这不是合法牌型',
      'size-mismatch': '张数必须和桌面一致',
      'not-bigger': '压不过桌面这张',
      'need-D4': '第一手必须带 ♦4',
      'need-D4-single': '第一手只能出 ♦4',
      'too-many': '一次最多 5 张',
      'trio-off': '本房间不允许三个单出',
      'cannot-pass-leading': '起手不能过牌'
    };
    return map[code] || code;
  }

  // ---------- AI 轮转 ----------
  var AUTO = /auto=1/.test(location.search);   // 观战模式：南家也交给 AI（仅用于预览/自测）

  function scheduleAI() {
    if (!S.game || S.game.over || S.phase !== 'play') return;
    var humanAuto = AUTO && S.game.turn === 0;
    if (S.game.turn === 0 && !humanAuto) { render(); return; }
    S.busy = true;
    renderActions();
    setTimeout(function () {
      if (!S.game || S.game.over) { S.busy = false; return; }
      var p = S.game.turn;
      var action = S.level === 0
        ? GX.AI.decide(S.game, p)
        : GX.AI2.decide(S.game, p, S.level);
      if (action.type === 'play') GX.Table.play(S.game, p, action.cards);
      else if (GX.Table.pass(S.game, p)) {
        // 兜底：领出时不能过，改出最小合法
        var cands = GX.Moves.candidates(S.game.players[p].hand, S.cfg);
        var ok = cands.filter(function (c) { return GX.Table.validate(S.game, p, c.cards) === null; });
        if (ok.length) GX.Table.play(S.game, p, GX.Moves.lowest(ok).cards);
      }
      S.busy = false;
      render();
      if (S.game.over) { maybeFinishRound(); return; }
      scheduleAI();
    }, 620);
  }

  function maybeFinishRound() {
    if (!S.game || !S.game.over) return;
    clearTurnTimer();
    var res = GX.Settle.settle(S.game);
    S.lastResult = res;
    res.scores.forEach(function (s, i) { S.scores[i] += s; });
    S.phase = 'settle';
    render();
  }

  // ---------- 开局 ----------
  function newMatch() {
    S.rounds = Number(el('roundSelect').value) || 8;
    S.scores = [0, 0, 0, 0];
    S.round = 0;
    S.lastResult = null;
    S.phase = 'idle';
    S.game = null;
    el('settleWrap').classList.remove('show');
    startRound();
  }

  function startRound() {
    S.round++;
    clearTurnTimer();
    S.selected = [];
    S.hint = '';
    S.log = [];
    var seed = Math.floor(Math.random() * 4e9);
    var g = GX.Table.createRound({ seed: seed, config: S.cfg });
    S.game = g;
    S.phase = 'play';
    S.busy = false;

    if (S.round >= 2 && S.cfg.tributeEnabled && S.lastResult) {
      var plan = GX.Tribute.plan(S.lastResult, S.cfg);
      if (!plan.skip && plan.count > 0) {
        S.tribute = {
          plan: plan, draws: [], reveals: [], log: [],
          shares: GX.Tribute.distribute(plan.count, plan.winners.length),
          need: 0, stage: 'draw', humanIsWinner: plan.winners.indexOf(0) >= 0,
          humanDrawn: []
        };
        S.tribute.need = S.tribute.humanIsWinner
          ? S.tribute.shares[plan.winners.indexOf(0)] : 0;
        S.phase = 'tribute';
        if (!S.tribute.humanIsWinner) runTributeAllForAI();
      }
    }
    render();
    if (S.phase === 'play') scheduleAI();
  }

  // ---------- 进贡 ----------
  function tributeSeatClick(p) {
    var T = S.tribute;
    if (!T || T.stage !== 'draw' || !T.humanIsWinner) return;
    if (T.humanDrawn.length >= T.need) return;
    if (T.plan.losers.indexOf(p) < 0) { toast('只能从上一局败方手里抽'); return; }

    var guard = 0;
    while (guard++ < 40) {
      var hand = S.game.players[p].hand;
      if (!hand.length) return;
      var idx = Math.floor(Math.random() * hand.length);
      var card = hand[idx];
      if (GX.Tribute.isIdentity(card)) {
        T.reveals.push({ owner: p, card: card });
        T.log.push({ text: SEAT_NAMES[p] + ' 的 ' + suitRank(card) + ' 是身份牌，亮出后归还，重新抽一张', kind: 'warn' });
        S.game.players[p].revealed = true;
        var rv = card.r;
        S.game.players[p].revealedCards = (S.game.players[p].revealedCards || []).concat([rv]);
        S.game.players[p].revealedCard = rv;
        continue;
      }
      hand.splice(idx, 1);
      S.game.players[0].hand.push(card);
      T.draws.push({ from: p, to: 0, card: card });
      T.humanDrawn.push({ from: p, card: card });
      T.log.push({ text: '从 ' + SEAT_NAMES[p] + ' 抽到 ' + suitRank(card), kind: 'draw' });
      break;
    }
    if (T.humanDrawn.length >= T.need) { T.stage = 'return'; S.hint = '选 ' + T.need + ' 张还贡'; }
    render();
  }

  function updateTributeReturn() { renderActions(); }

  function confirmReturn() {
    var T = S.tribute;
    if (!T || T.stage !== 'return') return;
    var cards = currentSelection();
    if (cards.length !== T.need) { toast('要选 ' + T.need + ' 张'); return; }
    // 逐张还给对应的被抽者
    var targets = T.humanDrawn.map(function (d) { return d.from; });
    cards.forEach(function (c, i) {
      var idx = S.game.players[0].hand.findIndex(function (x) { return sameCard(x, c); });
      if (idx < 0) return;
      S.game.players[0].hand.splice(idx, 1);
      var to = targets[i] === undefined ? targets[0] : targets[i];
      S.game.players[to].hand.push(c);
      T.log.push({ text: '还贡 ' + suitRank(c) + ' 给 ' + SEAT_NAMES[to], kind: 'ret' });
    });
    S.selected = [];
    T.stage = 'done';
    finishTribute();
  }

  function runTributeAllForAI() {
    var T = S.tribute;
    var plan = T.plan;
    var guardTotal = 0;
    // 每个胜方按份额抽牌，抽完自行还最低牌
    plan.winners.forEach(function (w, wi) {
      var need = T.shares[wi];
      if (w === 0 && T.humanIsWinner) return;  // 人类自己来
      for (var k = 0; k < need; k++) {
        var target = plan.losers[Math.floor(Math.random() * plan.losers.length)];
        var guard = 0, picked = null;
        while (guard++ < 40) {
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
          picked = { from: target, to: w, card: card };
          T.draws.push(picked);
          T.log.push({ text: SEAT_NAMES[w] + ' 从 ' + SEAT_NAMES[target] + ' 抽到 ' + suitRank(card), kind: 'draw' });
          break;
        }
        // 还贡：还一张最低的非身份牌给同一个被抽者
        if (picked) {
          var mine = S.game.players[w].hand.slice().filter(function (c) { return !GX.Tribute.isIdentity(c); })
            .sort(function (a, b) {
              return GX.Rules.rankVal(a.r, S.cfg.rankOrder) - GX.Rules.rankVal(b.r, S.cfg.rankOrder);
            });
          if (mine.length) {
            var give = mine[0];
            var i2 = S.game.players[w].hand.findIndex(function (x) { return sameCard(x, give); });
            S.game.players[w].hand.splice(i2, 1);
            S.game.players[target].hand.push(give);
            T.log.push({ text: SEAT_NAMES[w] + ' 还贡 ' + suitRank(give) + ' 给 ' + SEAT_NAMES[target], kind: 'ret' });
          }
        }
      }
    });
    guardTotal += 1;
    if (!T.humanIsWinner) {
      T.stage = 'done';
      finishTribute();
    }
  }

  function finishTribute() {
    var T = S.tribute;
    // 先出权：被抽走的牌里最大的一张，其原主人先出
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
    S.game.firstPlayPending = false;  // 进贡先出不受 ♦4 限制
    S.phase = 'play';
    S.tribute = null;
    S.hint = lead >= 0 ? SEAT_NAMES[lead] + ' 被抽走最大牌，先出' : '';
    render();
    scheduleAI();
  }

  function suitRank(c) { return SUIT_CHAR[c.s] + rankText(c.r); }

  // ---------- 渲染：进贡面板 ----------
  function renderTribute() {
    var wrap = el('tributeWrap');
    var T = S.tribute;
    if (!T) { wrap.classList.remove('show'); return; }
    wrap.classList.add('show');
    el('tributeTitle').textContent = '第 ' + S.round + ' 局 · 进贡';
    var info = '上一局胜方名次 ' + T.plan.winnerRanks.join('、') +
      ' → ' + (S.cfg.tributeTier === 'heavy' ? '重贡' : '轻贡') + ' 抽 ' + T.plan.count + ' 张';
    el('tributeInfo').textContent = info;

    var stageText = T.stage === 'draw'
      ? (T.humanIsWinner ? '点对方的座位，从他的手里抽牌（已抽 ' + T.humanDrawn.length + '/' + T.need + '）' : '等待胜方抽牌')
      : (T.stage === 'return' ? '选 ' + T.need + ' 张还贡' : '进贡完成');
    el('tributeStage').textContent = stageText;

    el('tributeLog').innerHTML = T.log.map(function (l) {
      return '<div class="log-line ' + l.kind + '">' + l.text + '</div>';
    }).join('');

    var drawnHTML = T.draws.map(function (d) {
      return '<div class="drawn"><div class="mini">' + cardHTML(d.card, 'mini') + '</div>' +
        '<span class="src">' + SEAT_NAMES[d.from] + '</span></div>';
    }).join('');
    el('drawnArea').innerHTML = drawnHTML || '<span class="muted">尚无抽牌</span>';

    el('btnTributeReturn').style.display = (T.stage === 'return' && T.humanIsWinner) ? 'inline-flex' : 'none';
    el('btnTributeSkip').style.display = 'none';
    // 可点击的败方座位
    T.plan.losers.forEach(function (p) {
      el('seat-' + SEAT_POS[p]).classList.toggle('pickable', T.stage === 'draw' && T.humanIsWinner);
    });
  }

  // ---------- 渲染：结算 ----------
  function renderSettle() {
    var wrap = el('settleWrap');
    if (S.phase !== 'settle') { wrap.classList.remove('show'); return; }
    var res = S.lastResult;
    wrap.classList.add('show');
    var rankNames = ['第 1 名', '第 2 名', '第 3 名', '第 4 名'];
    var rows = res.ranks.map(function (p, i) {
      var teamTag = '';
      if (res.camp.mode === 'lone') teamTag = p === res.camp.lone ? '独食' : '三人队';
      else teamTag = res.camp.teamA.indexOf(p) >= 0 ? '♠3/♠A 队' : '对方队';
      return '<tr><td>' + rankNames[i] + '</td><td>' + SEAT_NAMES[p] + '</td><td>' + teamTag +
        '</td><td class="num ' + (res.scores[p] > 0 ? 'pos' : res.scores[p] < 0 ? 'neg' : '') + '">' +
        (res.scores[p] > 0 ? '+' : '') + res.scores[p] + '</td><td class="num">' + S.scores[p] + '</td></tr>';
    }).join('');
    el('settleBody').innerHTML = rows;
    var title = res.camp.mode === 'lone' ? '本局：独食 1 打 3' : '本局：2 打 2';
    var sub = res.camp.mode === 'lone'
      ? '独食者 ' + SEAT_NAMES[res.camp.lone] + ' 拿第 ' + (res.ranks.indexOf(res.camp.lone) + 1) + ' 名'
      : '胜方名次 ' + res.winRanks.join('、');
    el('settleTitle').textContent = title;
    el('settleSub').textContent = sub;
    var isLast = S.round >= S.rounds;
    el('btnNext').textContent = isLast ? '看总成绩' : '下一局';
    el('btnNext').dataset.last = isLast ? '1' : '0';
  }

  function onNext() {
    if (el('btnNext').dataset.last === '1') {
      showSummary();
      return;
    }
    startRound();
  }

  function showSummary() {
    S.phase = 'idle';
    el('settleWrap').classList.remove('show');
    var best = Math.max.apply(null, S.scores);
    var lines = S.scores.map(function (s, i) {
      return '<div class="sum-row"><span>' + SEAT_NAMES[i] + '</span><span class="' +
        (s > 0 ? 'pos' : s < 0 ? 'neg' : '') + '">' + (s > 0 ? '+' : '') + s + '</span></div>';
    }).join('');
    el('summaryBody').innerHTML = lines;
    el('summaryTitle').textContent = '全场结束 · ' + S.rounds + ' 局';
    el('summarySub').textContent = '最高 ' + (best > 0 ? '+' : '') + best + ' 分';
    el('summaryWrap').classList.add('show');
  }

  // ---------- 杂项 ----------
  var toastTimer = null;
  function toast(msg) {
    var t = el('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  function init() {
    el('hand').addEventListener('click', onHandClick);
    el('btnPlay').addEventListener('click', doPlay);
    el('btnPass').addEventListener('click', doPass);
    el('btnHint').addEventListener('click', doHint);
    el('btnNext').addEventListener('click', onNext);
    el('btnCloseSummary').addEventListener('click', function () {
      el('summaryWrap').classList.remove('show');
      newMatch();
    });
    el('btnNewMatch').addEventListener('click', function () {
      if (S.phase === 'play' || S.phase === 'tribute') {
        if (!confirm('放弃当前对局，重新开一场？')) return;
      }
      newMatch();
    });
    el('btnTributeReturn').addEventListener('click', confirmReturn);
    BOUND_SEATS.forEach(function (s) {
      el('seat-' + s.pos).addEventListener('click', function () { tributeSeatClick(s.p); });
    });
    // 房间开关：进贡重/轻
    el('tierSelect').addEventListener('change', function () {
      S.cfg.tributeTier = el('tierSelect').value;
      toast('下次开局生效');
    });
    // 对手强度：新手 / 普通 / 高手，立即生效
    el('levelSelect').addEventListener('change', function () {
      S.level = Number(el('levelSelect').value) || 0;
      toast('对手强度：' + el('levelSelect').selectedOptions[0].textContent);
    });
    render();
    startRound();
  }

  window.addEventListener('DOMContentLoaded', init);
})();
