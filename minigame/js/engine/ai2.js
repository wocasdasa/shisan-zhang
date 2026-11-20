(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./hand.js'), require('./moves.js'), require('./table.js'), require('./info.js'));
  else { root.GX = root.GX || {}; root.GX.AI2 = factory(root.GX.Hand, root.GX.Moves, root.GX.Table, root.GX.Info); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Hand, Moves, Table, Info) {

  function hasIdentity(cards) {
    return cards.some(function (c) { return c.s === 3 && (c.r === 3 || c.r === 14); });
  }

  function cost(item, view) {
    var s = Hand.strength(item.combo);
    if (hasIdentity(item.cards)) s += 3e7;
    if (view.cardsLeft > 6 && item.combo.size === 5) s += 1e6;
    return s;
  }

  // 三档强度：0 交给 ai.js（各打各的），这里负责 1 普通 / 2 高手
  function profileOf(level) {
    if (level === 2) {
      return { blockAt: 4, holdIdentityAbove: 3, unknownGuard: false, leadTight: true };
    }
    return { blockAt: 2, holdIdentityAbove: 5, unknownGuard: true, leadTight: false };
  }

  // 队友让牌 AI：只用 Info.build 给出的公开信息 + 自己手牌
  function decide(game, player, level) {
    var prof = profileOf(level || 1);
    var view = Info.build(game, player);
    var cfg = game.cfg;
    var hand = view.hand;
    var n = hand.length;
    if (!n) return { type: 'pass' };

    var cands = Moves.candidates(hand, cfg);
    var legal = cands.filter(function (c) { return Table.validate(game, player, c.cards) === null; });
    var partners = view.partners;

    // ---------- 领出 ----------
    if (!view.combo) {
      if (!legal.length) return { type: 'pass' };
      var nextPlayer = (player + 3) % 4;   // 逆时针，下家
      if (partners.indexOf(nextPlayer) >= 0 && view.handCounts[nextPlayer] > 0 && view.handCounts[nextPlayer] <= 4) {
        var small = legal.filter(function (c) { return c.combo.size === 1; })
          .sort(function (a, b) { return Hand.strength(a.combo) - Hand.strength(b.combo); })[0];
        if (small) return { type: 'play', cards: small.cards };
      }
      var best = null, bestCost = Infinity;
      legal.forEach(function (c) {
        var v = cost(c, view);
        if (v < bestCost) { bestCost = v; best = c; }
      });
      return { type: 'play', cards: best.cards };
    }

    // ---------- 跟牌 ----------
    // 队友领先 → 不压自己人
    if (partners.indexOf(view.comboOwner) >= 0) return { type: 'pass' };

    var beats = legal.filter(function (c) { return Moves.beating([c], view.combo).length > 0; });
    if (!beats.length) return { type: 'pass' };

    var pick = null, pickCost = Infinity;
    beats.forEach(function (c) {
      var v = cost(c, view);
      if (v < pickCost) { pickCost = v; pick = c; }
    });

    var oppMin = 99;
    view.opponents.forEach(function (p) {
      if (view.handCounts[p] > 0 && view.handCounts[p] < oppMin) oppMin = view.handCounts[p];
    });
    if (oppMin <= prof.blockAt) return { type: 'play', cards: pick.cards };   // 对手快走完，必压

    // 还没推出阵营时：对方没亮身份，可能是我队友 → 不拿大牌硬压
    if (prof.unknownGuard && view.kind === 'unknown' && !view.revealed[view.comboOwner]) {
      if (pick.combo.size === 5 || hasIdentity(pick.cards)) return { type: 'pass' };
    }

    if (hasIdentity(pick.cards) && n > prof.holdIdentityAbove) return { type: 'pass' };  // 唯一的压牌是♠3/♠A，留着

    // 队友快出完：别再抢着出，把机会让给队友
    var partnerMin = 99;
    partners.forEach(function (p) {
      if (view.handCounts[p] > 0 && view.handCounts[p] < partnerMin) partnerMin = view.handCounts[p];
    });
    if (participantLow(partnerMin, n, pick)) return { type: 'pass' };

    return { type: 'play', cards: pick.cards };
  }

  function participantLow(partnerMin, n, pick) {
    return partnerMin <= 3 && n > partnerMin + 4 && Hand.strength(pick.combo) > 1e6;
  }

  function auto(game) {
    if (game.over) return null;
    var player = game.turn;
    var action = decide(game, player);
    if (action.type === 'play') return Table.play(game, player, action.cards);
    var err = Table.pass(game, player);
    if (err) return err;
    return null;
  }

  return { decide: decide, auto: auto, cost: cost };
});
