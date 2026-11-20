(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.GX = root.GX || {}; root.GX.Info = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // 信息受限视角：只允许用「自己的手牌 + 公开信息」推断
  // 公开信息：各家剩牌张数、谁打出过哪张身份牌（♠3 / ♠A）、桌面牌、谁过牌、已出完名次
  function build(game, player) {
    var me = game.players[player];
    var hand = me.hand;

    var myCards = (me.revealedCards || []).slice();
    if (hand.some(function (c) { return c.s === 3 && c.r === 3; })) myCards.push(3);
    if (hand.some(function (c) { return c.s === 3 && c.r === 14; })) myCards.push(14);

    var myS3 = myCards.indexOf(3) >= 0;
    var mySA = myCards.indexOf(14) >= 0;

    // 别人公开打出的身份牌
    var shown = {};   // playerId -> [3, 14]
    game.players.forEach(function (p) {
      if (p.id === player) return;
      shown[p.id] = (p.revealedCards || []).slice();
    });

    var kind = 'unknown', partners = [];

    if (myS3 && mySA) {
      // 我自己就是独食者，其他三人全是对手
      kind = 'lone';
    } else if (myS3 || mySA) {
      kind = 'team';
      var want = myS3 ? 14 : 3;
      [0, 1, 2, 3].forEach(function (p) {
        if (p === player) return;
        if ((shown[p] || []).indexOf(want) >= 0) partners.push(p);
      });
    } else {
      // 我一张身份牌都没有 → 两种情况
      // ① 有人同时打出 ♠3 和 ♠A → 他是独食者，我们剩下三人是一队
      var loneSeen = -1;
      [0, 1, 2, 3].forEach(function (p) {
        if (p === player) return;
        var sc = shown[p] || [];
        if (sc.indexOf(3) >= 0 && sc.indexOf(14) >= 0) loneSeen = p;
      });
      if (loneSeen >= 0) {
        kind = 'team';
        partners = [0, 1, 2, 3].filter(function (p) { return p !== player && p !== loneSeen; });
      } else {
        var s3Shown = [], saShown = [];
        [0, 1, 2, 3].forEach(function (p) {
          if (p === player) return;
          var sc = shown[p] || [];
          if (sc.indexOf(3) >= 0) s3Shown.push(p);
          if (sc.indexOf(14) >= 0) saShown.push(p);
        });
        if (s3Shown.length && saShown.length) {
          // ♠3、♠A 分别被人亮出 → 这两人是对方一队，剩下那个是我队友
          kind = 'team';
          var taken = s3Shown.concat(saShown);
          partners = [0, 1, 2, 3].filter(function (p) { return p !== player && taken.indexOf(p) < 0; });
        } else {
          kind = 'unknown';
        }
      }
    }

    var opponents = [0, 1, 2, 3].filter(function (p) {
      return p !== player && partners.indexOf(p) < 0;
    });
    if (kind === 'unknown') opponents = [0, 1, 2, 3].filter(function (p) { return p !== player; });

    return {
      player: player, hand: hand, kind: kind, partners: partners, opponents: opponents,
      handCounts: game.players.map(function (p) { return p.hand.length; }),
      revealed: game.players.map(function (p) { return p.revealed; }),
      combo: game.combo, comboOwner: game.comboOwner,
      passes: game.passes, ranks: game.ranks.slice(),
      cardsLeft: hand.length
    };
  }

  return { build: build };
});
