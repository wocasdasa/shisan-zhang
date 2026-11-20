(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./hand.js'), require('./rules.js'));
  else { root.GX = root.GX || {}; root.GX.Moves = factory(root.GX.Hand, root.GX.Rules); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Hand, Rules) {

  function key(cards) {
    return cards.map(function (c) { return c.s + ':' + c.r; }).sort().join('|');
  }

  function groupByRank(hand) {
    var map = {};
    hand.forEach(function (c) { (map[c.r] = map[c.r] || []).push(c); });
    return map;
  }

  function pickLowest(group, n) {
    return group.slice().sort(function (a, b) { return a.s - b.s; }).slice(0, n);
  }

  // 结构化生成候选牌型（不枚举全部 C(13,5)），供 AI 与合法性建议使用
  function candidates(hand, cfg) {
    var out = [], seen = {};
    var order = cfg.rankOrder;
    function push(cards) {
      if (!cards || cards.length > cfg.maxCards) return;
      var parsed = Hand.parse(cards, cfg);
      if (!parsed) return;
      if (parsed.size === 3 && !cfg.allowTrio) return;
      var k = key(cards);
      if (seen[k]) return;
      seen[k] = true;
      out.push({ cards: cards.slice(), combo: parsed });
    }

    // 单张
    hand.forEach(function (c) { push([c]); });

    var byRank = groupByRank(hand);
    var rankKeys = Object.keys(byRank).map(Number).sort(function (a, b) {
      return Rules.rankVal(a, order) - Rules.rankVal(b, order);
    });

    // 对子 / 三个
    rankKeys.forEach(function (r) {
      var g = byRank[r];
      if (g.length >= 2) push(pickLowest(g, 2));
      if (g.length >= 3) push(pickLowest(g, 3));
      if (g.length >= 4) push(pickLowest(g, 4));
    });

    // 三个带一对 / 四个带单张
    rankKeys.forEach(function (tr) {
      if (byRank[tr].length < 3) return;
      rankKeys.forEach(function (pr) {
        if (pr === tr || byRank[pr].length < 2) return;
        push(pickLowest(byRank[tr], 3).concat(pickLowest(byRank[pr], 2)));
      });
      if (byRank[tr].length >= 4) {
        hand.forEach(function (c) {
          if (c.r === tr) return;
          push(pickLowest(byRank[tr], 4).concat([c]));
        });
      }
    });

    // 杂顺 / 同花顺
    Rules.STRAIGHTS.forEach(function (entry) {
      var seq = entry[0], topRank = entry[1];
      // 杂顺：每档取最小花色
      var picked = [], ok = true;
      for (var i = 0; i < 5; i++) {
        var g = byRank[seq[i]];
        if (!g || !g.length) { ok = false; break; }
        picked.push(pickLowest(g, 1)[0]);
      }
      if (ok) push(picked);

      // 同花顺：同花色的 5 连
      for (var s = 0; s < 4; s++) {
        var sameSuit = [], full = true;
        for (var j = 0; j < 5; j++) {
          var grp = byRank[seq[j]];
          var found = grp ? grp.filter(function (c) { return c.s === s; })[0] : null;
          if (!found) { full = false; break; }
          sameSuit.push(found);
        }
        if (full) push(sameSuit);
      }
      // topRank 仅用于说明
      void topRank;
    });

    // 同花（取该花色最低 5 张 / 最高 5 张两个代表）
    for (var suit = 0; suit < 4; suit++) {
      var same = hand.filter(function (c) { return c.s === suit; });
      if (same.length < 5) continue;
      var asc = same.slice().sort(function (a, b) { return Rules.rankVal(a.r, order) - Rules.rankVal(b.r, order); });
      push(asc.slice(0, 5));
      push(asc.slice(-5));
    }

    return out;
  }

  function hasCard(hand, cards) {
    var pool = hand.slice();
    for (var i = 0; i < cards.length; i++) {
      var idx = -1;
      for (var j = 0; j < pool.length; j++) {
        if (pool[j].r === cards[i].r && pool[j].s === cards[i].s) { idx = j; break; }
      }
      if (idx < 0) return false;
      pool.splice(idx, 1);
    }
    return true;
  }

  function containsCard(cards, r, s) {
    return !!cards.filter(function (c) { return c.r === r && c.s === s; })[0];
  }

  function beating(cands, combo) {
    if (!combo) return cands.slice();
    return cands.filter(function (c) {
      return c.combo.size === combo.size && Hand.compare(c.combo, combo) > 0;
    });
  }

  function lowest(cands) {
    var best = null;
    cands.forEach(function (c) {
      if (!best || Hand.strength(c.combo) < Hand.strength(best.combo)) best = c;
    });
    return best;
  }

  return {
    candidates: candidates, hasCard: hasCard, containsCard: containsCard,
    beating: beating, lowest: lowest, key: key
  };
});
