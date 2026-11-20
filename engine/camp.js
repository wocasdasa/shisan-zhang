(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.GX = root.GX || {}; root.GX.Camp = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  function findHolder(hands, rank, suit) {
    for (var p = 0; p < hands.length; p++) {
      for (var i = 0; i < hands[p].length; i++) {
        if (hands[p][i].r === rank && hands[p][i].s === suit) return p;
      }
    }
    return -1;
  }

  // 黑桃3(♠3) 与 黑桃A(♠A) 的持有者同队；一人同持即独食 1 打 3
  function analyze(hands) {
    var s3 = findHolder(hands, 3, 3);
    var sA = findHolder(hands, 14, 3);
    if (s3 < 0 || sA < 0) return { mode: 'broken', s3: s3, sA: sA, teamA: [], teamB: [0, 1, 2, 3] };
    if (s3 === sA) {
      var others = [0, 1, 2, 3].filter(function (i) { return i !== s3; });
      return {
        mode: 'lone', lone: s3, s3: s3, sA: sA,
        teamA: [s3], teamB: others,
        teams: { lone: [s3], rest: others }
      };
    }
    var teamB = [0, 1, 2, 3].filter(function (i) { return i !== s3 && i !== sA; });
    return {
      mode: 'team', s3: s3, sA: sA,
      teamA: [s3, sA], teamB: teamB,
      teams: { a: [s3, sA], b: teamB }
    };
  }

  function teamOf(camp, player) {
    if (camp.mode === 'lone') return player === camp.lone ? 0 : 1;
    if (camp.teamA.indexOf(player) >= 0) return 0;
    return 1;
  }

  function isLone(camp, player) { return camp.mode === 'lone' && camp.lone === player; }

  // 出牌后是否触发身份揭示（打出 ♠3 或 ♠A）
  function revealTrigger(cards) {
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].s === 3 && (cards[i].r === 3 || cards[i].r === 14)) return true;
    }
    return false;
  }

  return { analyze: analyze, teamOf: teamOf, isLone: isLone, revealTrigger: revealTrigger };
});
