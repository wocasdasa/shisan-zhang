(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'), require('./cards.js'), require('./hand.js'));
  else { root.GX = root.GX || {}; root.GX.Tribute = factory(root.GX.Rules, root.GX.Cards, root.GX.Hand); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Rules, Cards, Hand) {

  function isIdentity(card) { return card.s === 3 && (card.r === 3 || card.r === 14); }

  // 依据上一局的名次与阵营，算进贡计划
  function plan(lastResult, cfg) {
    if (!cfg.tributeEnabled) return { count: 0, skip: true };
    var ranks = lastResult.ranks, camp = lastResult.camp;
    var firstTeamPlayers = (camp.mode === 'lone' && camp.lone === ranks[0])
      ? [camp.lone] : camp.teamA.concat(camp.teamB).filter(function (p) { return takeTeam(camp, p) === takeTeam(camp, ranks[0]); });
    // 胜方 = 与第 1 名同队的人
    var winners = [0, 1, 2, 3].filter(function (p) { return takeTeam(camp, p) === takeTeam(camp, ranks[0]); });
    var losers = [0, 1, 2, 3].filter(function (p) { return takeTeam(camp, p) !== takeTeam(camp, ranks[0]); });
    var winnerRanks = winners.map(function (p) { return ranks.indexOf(p) + 1; }).sort();
    var count = Rules.tributeCount(winnerRanks, cfg.tributeTier);
    void firstTeamPlayers;
    return {
      count: count, winners: winners, losers: losers,
      winnerRanks: winnerRanks, tier: cfg.tributeTier, cfg: cfg,
      skip: count === 0
    };
  }

  function takeTeam(camp, p) {
    if (camp.mode === 'lone') return p === camp.lone ? 0 : 1;
    return camp.teamA.indexOf(p) >= 0 ? 0 : 1;
  }

  function lowestCards(hand, n, cfg) {
    return hand.slice().sort(function (a, b) {
      return (Rules.rankVal(a.r, cfg.rankOrder) - Rules.rankVal(b.r, cfg.rankOrder)) || (a.s - b.s);
    }).filter(function (c) { return !isIdentity(c); }).slice(0, n);
  }

  // 执行进贡：直接改 hands（数组 of 4 手牌）
  function run(hands, p, seed) {
    if (p.skip || p.count <= 0) return { skipped: true, draws: [], reveal: [], leadPlayer: -1 };

    var rnd = Cards.mulberry32((seed >>> 0) || 1);
    var draws = [], reveals = [];
    var shares = distribute(p.count, p.winners.length);
    var ledCandidates = [];   // 用于"被抽最大牌的原主人先出"

    p.winners.forEach(function (w, wi) {
      var need = shares[wi];
      for (var k = 0; k < need; k++) {
        // 任选一名负方玩家（一人以上则随机挑）
        var target = p.losers[Math.floor(rnd() * p.losers.length)];
        if (p.losers.length === 1) target = p.losers[0];

        var guard = 0;
        var picked = null;
        while (guard++ < 40) {
          var pool = hands[target];
          if (!pool.length) break;
          var idx = Math.floor(rnd() * pool.length);
          var card = pool[idx];
          if (isIdentity(card)) {
            reveals.push({ owner: target, card: card, to: w });
            continue;                     // 亮牌、归还（不动手牌），重抽
          }
          pool.splice(idx, 1);
          hands[w].push(card);
          picked = card;
          break;
        }
        if (picked) draws.push({ from: target, to: w, card: picked });
      }
    });

    // 还贡：抽牌方自己决定还哪几张（还最低的非身份牌），还给对应被抽者
    draws.forEach(function (d) {
      var give = lowestCards(hands[d.to], 1, p.cfg || Rules.DEFAULT);
      if (!give.length) return;
      var card = give[0];
      var idx = hands[d.to].indexOf(card);
      if (idx >= 0) hands[d.to].splice(idx, 1);
      hands[d.from].push(card);
      d.returned = card;
    });

    // 被抽走的牌里最大的一张，其原主人先出
    var lead = -1;
    if (draws.length && p.cfg && p.cfg.tributeFirstLead === 'maxCardOwner') {
      var best = null;
      draws.forEach(function (d) {
        if (!best) { best = d; return; }
        var cmp = Hand.compare(
          Hand.parse([d.card], p.cfg), Hand.parse([best.card], p.cfg)
        );
        if (cmp > 0) best = d;
      });
      lead = best ? best.from : -1;
    }

    return { skipped: false, draws: draws, reveal: reveals, leadPlayer: lead };
  }

  function distribute(total, n) {
    var out = [], base = Math.floor(total / n), extra = total % n;
    for (var i = 0; i < n; i++) out.push(base + (i < extra ? 1 : 0));
    return out;
  }

  return { plan: plan, run: run, distribute: distribute, isIdentity: isIdentity };
});
