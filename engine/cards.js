(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.GX = root.GX || {}; root.GX.Cards = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // 花色由小到大：方块 0 < 梅花 1 < 红桃 2 < 黑桃 3
  var SUITS = ['方块', '梅花', '红桃', '黑桃'];
  var SYMBOL = ['♦', '♣', '♥', '♠'];
  var RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

  function rankLabel(r) { return RANK_LABEL[r] || String(r); }
  function cardLabel(c) { return SYMBOL[c.s] + rankLabel(c.r); }

  function makeDeck() {
    var d = [];
    for (var s = 0; s < 4; s++) for (var r = 2; r <= 14; r++) d.push({ r: r, s: s });
    return d;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, seed) {
    var rnd = mulberry32((seed >>> 0) || 1);
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function sortDesc(cards) {
    return cards.slice().sort(function (x, y) { return (y.r - x.r) || (y.s - x.s); });
  }

  function same(a, b) { return a.r === b.r && a.s === b.s; }

  function cardKey(c) { return c.s * 13 + (c.r - 2); }

  function countRanks(cards) {
    var map = {};
    cards.forEach(function (c) { map[c.r] = (map[c.r] || 0) + 1; });
    return Object.keys(map).map(function (k) {
      return { r: Number(k), n: map[k] };
    }).sort(function (a, b) { return (b.n - a.n) || (b.r - a.r); });
  }

  return {
    SUITS: SUITS, SYMBOL: SYMBOL,
    rankLabel: rankLabel, cardLabel: cardLabel,
    makeDeck: makeDeck, shuffle: shuffle, sortDesc: sortDesc,
    same: same, cardKey: cardKey, countRanks: countRanks, mulberry32: mulberry32
  };
});
