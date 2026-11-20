(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./cards.js'), require('./rules.js'));
  else { root.GX = root.GX || {}; root.GX.Hand = factory(root.GX.Cards, root.GX.Rules); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Cards, Rules) {

  var KIND_ORDER = {
    single: 1, pair: 2, trio: 3, straight: 4,
    flush: 5, fullhouse: 6, four: 7, straightflush: 8
  };
  var KIND_LABEL = {
    single: '单张', pair: '一对', trio: '三个', straight: '杂顺',
    flush: '同花', fullhouse: '三个带一对', four: '四个带单张', straightflush: '同花顺'
  };

  function countRanks(cards) {
    var map = {};
    cards.forEach(function (c) { map[c.r] = (map[c.r] || 0) + 1; });
    return Object.keys(map).map(function (k) { return { r: Number(k), n: map[k] }; })
      .sort(function (a, b) { return (b.n - a.n) || (b.r - a.r); });
  }

  function maxSuitOf(cards) {
    var m = -1;
    cards.forEach(function (c) { if (c.s > m) m = c.s; });
    return m;
  }

  // 返回 { idx, topRank } 或 null
  function straightInfo(cards) {
    var ranks = {};
    cards.forEach(function (c) { ranks[c.r] = true; });
    if (Object.keys(ranks).length !== 5) return null;
    for (var i = 0; i < Rules.STRAIGHTS.length; i++) {
      var seq = Rules.STRAIGHTS[i][0];
      var ok = true;
      for (var j = 0; j < 5; j++) if (!ranks[seq[j]]) { ok = false; break; }
      if (ok) return { idx: i + 1, topRank: Rules.STRAIGHTS[i][1] };
    }
    return null;
  }

  function combo(kind, mainRank, mainSuit, cards) {
    return { kind: kind, size: cards.length, mainRank: mainRank, mainSuit: mainSuit, cards: cards, label: KIND_LABEL[kind] };
  }

  function sortByRank(cards, order) {
    return cards.slice().sort(function (x, y) {
      return (Rules.rankVal(y.r, order) - Rules.rankVal(x.r, order)) || (y.s - x.s);
    });
  }

  // 牌型识别；不可识别返回 null
  function parse(cards, cfg) {
    if (!cards || !cards.length) return null;
    var order = (cfg && cfg.rankOrder) || '3max';
    var n = cards.length;
    var sorted = sortByRank(cards, order);

    if (n === 1) return combo('single', Rules.rankVal(sorted[0].r, order), sorted[0].s, sorted);

    if (n === 2) {
      if (sorted[0].r !== sorted[1].r) return null;
      // 一对：比「较大的那张」的花色 = 两张里花色高的那张
      return combo('pair', Rules.rankVal(sorted[0].r, order), maxSuitOf(sorted), sorted);
    }

    if (n === 3) {
      if (!(sorted[0].r === sorted[1].r && sorted[1].r === sorted[2].r)) return null;
      return combo('trio', Rules.rankVal(sorted[0].r, order), maxSuitOf(sorted), sorted);
    }

    if (n !== 5) return null;

    var sameSuit = sorted.every(function (c) { return c.s === sorted[0].s; });
    var st = straightInfo(sorted);
    var counts = countRanks(sorted);

    if (sameSuit && st) {
      var topCardSf = sorted.filter(function (c) { return c.r === st.topRank; })[0] || sorted[0];
      return combo('straightflush', st.idx, topCardSf.s, sorted);
    }

    if (counts.length === 2) {
      var quad = counts.filter(function (c) { return c.n === 4; })[0];
      if (quad) {
        var quadCards = sorted.filter(function (c) { return c.r === quad.r; });
        return combo('four', Rules.rankVal(quad.r, order), maxSuitOf(quadCards), sorted);
      }
      var trip = counts.filter(function (c) { return c.n === 3; })[0];
      if (trip) {
        var tripCards = sorted.filter(function (c) { return c.r === trip.r; });
        return combo('fullhouse', Rules.rankVal(trip.r, order), maxSuitOf(tripCards), sorted);
      }
    }

    if (sameSuit) {
      var topFlush = sorted[0];
      return combo('flush', Rules.rankVal(topFlush.r, order), topFlush.s, sorted);
    }

    if (st) {
      var topCard = sorted.filter(function (c) { return c.r === st.topRank; })[0];
      return combo('straight', st.idx, topCard.s, sorted);
    }

    return null;
  }

  // 同张数才可比：返回 1 / 0 / -1；不可比 null
  function compare(a, b) {
    if (!a || !b) return null;
    if (a.size !== b.size) return null;
    var oa = KIND_ORDER[a.kind], ob = KIND_ORDER[b.kind];
    if (oa !== ob) return oa > ob ? 1 : -1;
    if (a.mainRank !== b.mainRank) return a.mainRank > b.mainRank ? 1 : -1;
    if (a.mainSuit !== b.mainSuit) return a.mainSuit > b.mainSuit ? 1 : -1;
    return 0;
  }

  function strength(c) {
    if (!c) return -1;
    return KIND_ORDER[c.kind] * 1e7 + c.mainRank * 100 + c.mainSuit;
  }

  return {
    KIND_ORDER: KIND_ORDER, KIND_LABEL: KIND_LABEL,
    parse: parse, compare: compare, strength: strength,
    sortByRank: sortByRank, countRanks: countRanks, straightInfo: straightInfo,
    kindLabel: function (k) { return KIND_LABEL[k] || k; }
  };
});
