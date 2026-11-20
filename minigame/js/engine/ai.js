(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./hand.js'), require('./moves.js'), require('./table.js'), require('./rules.js'));
  else { root.GX = root.GX || {}; root.GX.AI = factory(root.GX.Hand, root.GX.Moves, root.GX.Table, root.GX.Rules); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Hand, Moves, Table, Rules) {

  function hasIdentityCard(cards) {
    return cards.some(function (c) { return c.s === 3 && (c.r === 3 || c.r === 14); });
  }

  // 手牌强度惩罚：♠3/♠A 是最大单牌，尽量留到后面
  function cost(item, handSize) {
    var s = Hand.strength(item.combo);
    if (hasIdentityCard(item.cards)) s += 3e7;
    if (handSize > 6 && item.combo.size === 5) s += 1e6;  // 手牌多时别急着甩 5 张
    return s;
  }

  function decide(game, player) {
    var cfg = game.cfg;
    var hand = game.players[player].hand;
    if (!hand.length) return { type: 'pass' };
    var cands = Moves.candidates(hand, cfg);
    var n = hand.length;

    function legal(list) {
      return list.filter(function (c) { return Table.validate(game, player, c.cards) === null; });
    }

    if (!game.combo) {
      var leads = legal(cands);
      if (!leads.length) return { type: 'pass' };
      var best = null, bestCost = Infinity;
      leads.forEach(function (c) {
        var v = cost(c, n);
        if (v < bestCost) { bestCost = v; best = c; }
      });
      return { type: 'play', cards: best.cards };
    }

    var beats = legal(Moves.beating(cands, game.combo));
    if (!beats.length) return { type: 'pass' };

    var pick = null, pickCost = Infinity;
    beats.forEach(function (c) {
      var v = cost(c, n);
      if (v < pickCost) { pickCost = v; pick = c; }
    });

    // 唯一能压的牌要用 ♠3/♠A 且手牌还多 → 先过，留着
    if (hasIdentityCard(pick.cards) && n > 5) return { type: 'pass' };
    // 对手只剩 1 张时，能压就压
    var minOpp = 99;
    game.players.forEach(function (p) {
      if (p.id !== player && p.hand.length > 0 && p.hand.length < minOpp) minOpp = p.hand.length;
    });
    if (minOpp <= 2 && pick) return { type: 'play', cards: pick.cards };

    return { type: 'play', cards: pick.cards };
  }

  function auto(game) {
    if (game.over) return null;
    var player = game.turn;
    var action = decide(game, player);
    if (action.type === 'play') return Table.play(game, player, action.cards);
    var err = Table.pass(game, player);
    if (err) return err;   // 领出时不能过 → 由调用方兜底
    return null;
  }

  return { decide: decide, auto: auto, cost: cost };
});
