(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./cards.js'), require('./rules.js'), require('./hand.js'), require('./camp.js'), require('./moves.js'));
  else { root.GX = root.GX || {}; root.GX.Table = factory(root.GX.Cards, root.GX.Rules, root.GX.Hand, root.GX.Camp, root.GX.Moves); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Cards, Rules, Hand, Camp, Moves) {

  var SEATS = 4;

  function createRound(opt) {
    opt = opt || {};
    var cfg = Rules.resolve(opt.config);
    var seed = (opt.seed || 1) >>> 0;
    var deck = Cards.shuffle(Cards.makeDeck(), seed);
    var hands = [[], [], [], []];
    deck.forEach(function (c, i) { hands[i % SEATS].push(c); });
    if (opt.hands) {
      hands = [[], [], [], []];
      opt.hands.forEach(function (h, i) { hands[i] = h.slice(); });
    }
    hands.forEach(function (h) { h.sort(function (a, b) {
      return (Rules.rankVal(b.r, cfg.rankOrder) - Rules.rankVal(a.r, cfg.rankOrder)) || (b.s - a.s);
    }); });

    var camp = Camp.analyze(hands);
    var first = opt.firstPlayer;
    if (first === undefined || first === null || first < 0) {
      first = 0;
      for (var p = 0; p < SEATS; p++) {
        if (Moves.containsCard(hands[p], 4, 0)) { first = p; break; }   // 方块4
      }
    }

    var camp = Camp.analyze(hands);
    var first = 0;
    for (var p = 0; p < SEATS; p++) {
      if (Moves.containsCard(hands[p], 4, 0)) { first = p; break; }   // 方块4
    }

    var game = {
      cfg: cfg, seed: seed, camp: camp,
      players: hands.map(function (h, i) { return { id: i, hand: h, revealed: false }; }),
      turn: first, combo: null, comboOwner: -1, lastPlayer: -1,
      passes: {}, ranks: [], finishedCount: 0, over: false,
      firstPlayPending: cfg.requireFirstCard,
      trickPlays: [],
      history: [], turnCount: 0, violations: []
    };
    return game;
  }

  function activePlayers(game) {
    return game.players.filter(function (p) { return p.hand.length > 0; }).map(function (p) { return p.id; });
  }

  // 出牌顺序：逆时针（南→东→北→西），即座位号 -1
  function nextActive(game, from) {
    for (var i = 1; i <= SEATS; i++) {
      var p = (from - i + SEATS * 2) % SEATS;
      if (game.players[p].hand.length > 0) return p;
    }
    return -1;
  }

  // 校验：返回 null 表示合法，否则返回原因
  function validate(game, player, cards) {
    if (game.over) return 'over';
    if (game.turn !== player) return 'not-turn';
    if (game.players[player].hand.length === 0) return 'finished';
    if (game.passes[player]) return 'already-passed';
    if (!cards || !cards.length) return 'empty';
    if (cards.length > game.cfg.maxCards) return 'too-many';
    if (!Moves.hasCard(game.players[player].hand, cards)) return 'not-in-hand';

    var parsed = Hand.parse(cards, game.cfg);
    if (!parsed) return 'bad-combo';
    if (parsed.size === 3 && !game.cfg.allowTrio) return 'trio-off';

    if (game.combo) {
      if (parsed.size !== game.combo.size) return 'size-mismatch';
      if (Hand.compare(parsed, game.combo) <= 0) return 'not-bigger';
      return null;
    }

    // 起手（新一轮）
    var handHasD4 = Moves.containsCard(game.players[player].hand, 4, 0);
    var needD4 = game.firstPlayPending && game.cfg.requireFirstCard && handHasD4;
    if (game.cfg.requireFirstCardAlways && handHasD4) needD4 = true;
    if (needD4) {
      if (!Moves.containsCard(cards, 4, 0)) return 'need-D4';
      if (!game.cfg.allowFirstInCombo && cards.length !== 1) return 'need-D4-single';
    }
    return null;
  }

  function removeCards(hand, cards) {
    cards.forEach(function (c) {
      var idx = -1;
      for (var j = 0; j < hand.length; j++) if (hand[j].r === c.r && hand[j].s === c.s) { idx = j; break; }
      if (idx >= 0) hand.splice(idx, 1);
    });
  }

  function rankOf(game, player) {
    for (var i = 0; i < game.ranks.length; i++) if (game.ranks[i] === player) return i + 1;
    return -1;
  }

  function endTrick(game) {
    var leader;
    if (game.lastPlayer >= 0 && game.players[game.lastPlayer].hand.length > 0 && game.cfg.afterTrickLeader === 'last') {
      leader = game.lastPlayer;
    } else if (game.lastPlayer >= 0 && game.players[game.lastPlayer].hand.length > 0) {
      leader = nextActive(game, game.lastPlayer);
    } else {
      // 起手人已出完：出完牌者的下家起手
      leader = nextActive(game, game.lastPlayer >= 0 ? game.lastPlayer : game.turn);
    }
    game.combo = null;
    game.comboOwner = -1;
    game.passes = {};
    game.trickPlays = [];      // 本轮结束，桌面清空
    game.turn = leader >= 0 ? leader : game.turn;
    game.firstPlayPending = false;
    game.history.push({ type: 'trick-end', leader: game.turn });
  }

  function finishPlayer(game, player) {
    game.ranks.push(player);
    game.finishedCount++;
    game.history.push({ type: 'rank', player: player, rank: game.ranks.length });
  }

  function afterRemove(game) {
    var actives = activePlayers(game);
    if (actives.length <= 1) {
      if (actives.length === 1) {
        finishPlayer(game, actives[0]);
      }
      game.over = true;
      game.turn = -1;
      game.combo = null;
      return;
    }
  }

  function play(game, player, cards) {
    var err = validate(game, player, cards);
    if (err) { game.violations.push({ player: player, err: err, cards: cards }); return err; }

    removeCards(game.players[player].hand, cards);
    var parsed = Hand.parse(cards, game.cfg);
    game.combo = parsed;
    game.comboOwner = player;
    game.lastPlayer = player;
    game.passes = {};
    game.firstPlayPending = false;
    game.turnCount++;

    if (Camp.revealTrigger(cards)) {
      game.players[player].revealed = true;
      var idCards = cards.filter(function (c) { return c.s === 3 && (c.r === 3 || c.r === 14); });
      game.players[player].revealedCard = idCards[0].r;
      game.players[player].revealedCards = (game.players[player].revealedCards || []).concat(
        idCards.map(function (c) { return c.r; })
      );
      if (game.cfg.revealScope === 'team') {
        var partner = (game.camp.mode === 'team') ? (game.camp.s3 === player ? game.camp.sA : game.camp.s3) : -1;
        if (partner >= 0) game.players[partner].revealed = true;
      }
      game.history.push({ type: 'reveal', player: player, card: game.players[player].revealedCard });
    }

    game.history.push({ type: 'play', player: player, cards: cards, combo: parsed.kind });
    game.trickPlays.push({ player: player, cards: cards, combo: parsed });

    if (game.players[player].hand.length === 0) finishPlayer(game, player);

    // 独食者（已亮出 ♠3 与 ♠A）先把牌打完 → 本局立即结束，其余按剩牌张数定名次
    var loneMe = game.players[player];
    if (loneMe.hand.length === 0 && (loneMe.revealedCards || []).length >= 2 && game.ranks.length === 1) {
      game.players.filter(function (x) { return x.hand.length > 0; })
        .sort(function (a, b) { return a.hand.length - b.hand.length; })
        .forEach(function (x) { game.ranks.push(x.id); });
      game.over = true;
      game.turn = -1;
      game.combo = null;
      return null;
    }

    // rankMode = byRemaining：先出完即结束，其余按剩牌张数定名次
    if (game.cfg.rankMode === 'byRemaining' && game.ranks.length === 1) {
      var rest = game.players.filter(function (x) { return x.hand.length > 0; })
        .sort(function (a, b) {
          return (a.hand.length - b.hand.length) || (Rules.rankVal(b.hand[0].r, game.cfg.rankOrder) - Rules.rankVal(a.hand[0].r, game.cfg.rankOrder));
        });
      rest.forEach(function (x) { game.ranks.push(x.id); });
      game.over = true;
      game.turn = -1;
      game.combo = null;
      return null;
    }

    var actives = activePlayers(game);
    if (actives.length <= 1) {
      if (actives.length === 1) finishPlayer(game, actives[0]);
      game.over = true;
      game.turn = -1;
      game.combo = null;
      return null;
    }

    // 其他人都出完只剩最后出牌者 → 那也要结束
    if (actives.length === 0) { game.over = true; return null; }

    game.turn = nextActive(game, player);
    if (game.turn < 0) game.over = true;
    return null;
  }

  function pass(game, player) {
    if (game.over) return 'over';
    if (game.turn !== player) return 'not-turn';
    if (!game.combo) return 'cannot-pass-leading';
    if (game.passes[player]) return 'already-passed';

    game.passes[player] = true;
    game.history.push({ type: 'pass', player: player });
    game.turnCount++;

    var actives = activePlayers(game);
    var others = actives.filter(function (i) { return i !== game.lastPlayer; });
    var allPassed = others.every(function (i) { return !!game.passes[i]; });
    if (allPassed) { endTrick(game); return null; }

    game.turn = nextActive(game, player);
    if (game.turn < 0) game.over = true;
    return null;
  }

  function snapshot(game) {
    return {
      turn: game.turn, combo: game.combo, owner: game.comboOwner,
      ranks: game.ranks.slice(), over: game.over,
      hands: game.players.map(function (p) { return p.hand.length; })
    };
  }

  return {
    SEATS: SEATS,
    createRound: createRound, validate: validate, play: play, pass: pass,
    nextActive: nextActive, activePlayers: activePlayers, rankOf: rankOf,
    snapshot: snapshot, endTrick: endTrick
  };
});
