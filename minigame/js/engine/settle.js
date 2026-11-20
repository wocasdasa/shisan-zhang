(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'), require('./camp.js'));
  else { root.GX = root.GX || {}; root.GX.Settle = factory(root.GX.Rules, root.GX.Camp); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Rules, Camp) {

  // 名次制：ranks 为按出完顺序排列的玩家 id（第 1 名在前）
  function rankScores(ranks, camp, base) {
    base = base || 1;
    var teamA = camp.teamA, teamB = camp.teamB;
    var scores = [0, 0, 0, 0];

    if (camp.mode === 'lone') {
      var loneRank = ranks.indexOf(camp.lone) + 1;
      var tableLone = { 1: 6, 2: 3, 3: -3, 4: -6 };
      var tableOther = { 1: -2, 2: -1, 3: 1, 4: 2 };
      [0, 1, 2, 3].forEach(function (p) {
        scores[p] = (p === camp.lone ? tableLone[loneRank] : tableOther[loneRank]) * base;
      });
      return { mode: 'lone', loneRank: loneRank, scores: scores, teamScores: { lone: scores[camp.lone], rest: tableOther[loneRank] * 3 * base } };
    }

    // 2 打 2：胜方有名次 1，按队友名次组合定分
    var winIsA = teamA.indexOf(ranks[0]) >= 0;
    var winTeam = winIsA ? teamA : teamB;
    var loseTeam = winIsA ? teamB : teamA;
    var winRanks = winTeam.map(function (p) { return ranks.indexOf(p) + 1; }).sort();
    var comboKey = winRanks.join(',');
    var delta = comboKey === '1,2' ? 2 : (comboKey === '1,3' ? 1 : 0);

    winTeam.forEach(function (p) { scores[p] = delta * base; });
    loseTeam.forEach(function (p) { scores[p] = -delta * base; });

    return { mode: 'team', winRanks: winRanks, comboKey: comboKey, delta: delta, scores: scores };
  }

  // 剩牌倍数制（备用口径，规则书未冻结，仅"刺激局"预设使用）
  function remainScores(game, base) {
    base = base || 1;
    var ranks = game.ranks;
    var scores = [0, 0, 0, 0];
    ranks.forEach(function (p, i) {
      var mult = i === 0 ? 0 : i;            // 第2名 1×、第3名 2×、第4名 3×
      scores[p] = -game.players[p].hand.length * mult * base;
    });
    return { mode: 'remain', scores: scores };
  }

  function settle(game) {
    var cfg = game.cfg;
    var camp = game.camp;
    var result = cfg.scoring === 'remainMultiplier'
      ? remainScores(game, cfg.baseScore)
      : rankScores(game.ranks, camp, cfg.baseScore);
    result.ranks = game.ranks.slice();
    result.camp = camp;
    result.base = cfg.baseScore;
    result.teamScores = result.teamScores || teamTotals(result.scores, camp);
    result.sum = result.scores.reduce(function (a, b) { return a + b; }, 0);
    return result;
  }

  function teamTotals(scores, camp) {
    var out = [0, 0];
    scores.forEach(function (s, p) { out[Camp.teamOf(camp, p)] += s; });
    return { a: out[0], b: out[1], sum: out[0] + out[1] };
  }

  return { rankScores: rankScores, remainScores: remainScores, settle: settle };
});
