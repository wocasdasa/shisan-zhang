(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.GX = root.GX || {}; root.GX.Rules = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // 默认配置 = 规则书 v0.8「经典独食」
  var DEFAULT = {
    firstCard: 'D4',          // 方块4
    rankOrder: '3max',        // 3 最大、4 最小
    allowTrio: true,          // 三个能否单出
    maxCards: 5,
    requireFirstCard: true,   // 第一手必须含方块4
    requireFirstCardAlways: false,
    afterTrickLeader: 'last', // 三家连过后：最后出牌者起手
    allowSplit: true,
    allowFirstInCombo: true,
    turnSeconds: 20,
    timeoutAction: 'pass',
    revealScope: 'self',
    teamHint: 'none',
    revealAtEnd: true,
    loneMode: '1v3',
    loneAnnounce: false,      // 不公示"本局为独食"，三家只能自己推断
    loneMultiplier: 'off',
    scoring: 'rank',
    rankMode: 'finishAll',
    baseScore: 1,
    roundCount: 8,
    // 进贡（规则书 10.2-F）
    tributeEnabled: true,
    tributeTier: 'heavy',     // heavy: 4/2/0, light: 2/1/0
    tributeFrom: 'loserTeam',
    tributePick: 'any',
    tributeCard: 'draw',
    tributeReturn: 'chooser',
    tributeIdentity: 'revealReturnRedraw',
    tributeRevealIdentity: 'public',
    tributeFirstLead: 'maxCardOwner'
  };

  var PRESETS = {
    classic: {},
    quick: { rankMode: 'byRemaining', turnSeconds: 15, tributeEnabled: false },
    friends: { turnSeconds: 30, roundCount: 8, teamHint: 'reveal' },
    spicy: { scoring: 'remainMultiplier', baseScore: 5, loneMultiplier: 'dark3x', tributeTier: 'heavy' },
    teaching: { loneMode: 'redeal', teamHint: 'always', turnSeconds: 30, tributeEnabled: false }
  };

  // 点数序位：值越大牌越大
  // 3max: 3(13) > 2(12) > A(11) > K(10) > Q(9) > J(8) > 10(7) > 9(6) > 8(5) > 7(4) > 6(3) > 5(2) > 4(1)
  // A2:   A(13) > K(12) > ... > 2(1)
  function rankVal(r, order) {
    if (order === 'A2') return r - 1;
    if (r === 2) return 12;
    if (r === 3) return 13;
    return r - 3;            // 4→1 ... 14(A)→11
  }

  // 顺子表（两套点数序共用）：index 1 最小，10 最大；top 为最大那张的自然点数
  var STRAIGHTS = [
    [[14, 2, 3, 4, 5], 5],      // A2345
    [[2, 3, 4, 5, 6], 6],       // 23456
    [[3, 4, 5, 6, 7], 7],
    [[4, 5, 6, 7, 8], 8],
    [[5, 6, 7, 8, 9], 9],
    [[6, 7, 8, 9, 10], 10],
    [[7, 8, 9, 10, 11], 11],
    [[8, 9, 10, 11, 12], 12],
    [[9, 10, 11, 12, 13], 13],
    [[10, 11, 12, 13, 14], 14]  // 10JQKA
  ];

  function resolve(overrides) {
    var cfg = {};
    for (var k in DEFAULT) cfg[k] = DEFAULT[k];
    if (overrides) for (var k2 in overrides) {
      if (DEFAULT.hasOwnProperty(k2)) cfg[k2] = overrides[k2];
    }
    return cfg;
  }

  function fromPreset(name, overrides) {
    var p = PRESETS[name] || {};
    var merged = resolve(p);
    return resolve(overrides ? objectAssign(merged, overrides) : merged);
  }

  function objectAssign(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    for (var k2 in b) out[k2] = b[k2];
    return out;
  }

  // 进贡张数：按上局胜方名次组合
  function tributeCount(winnerRanks, tier) {
    var set = winnerRanks.slice().sort(function (a, b) { return a - b; }).join(',');
    if (set === '1,2') return tier === 'light' ? 2 : 4;
    if (set === '1,3') return tier === 'light' ? 1 : 2;
    if (set === '1') return tier === 'light' ? 1 : 2;   // 独食胜：每家抽 1/2 张（三家共 3N）
    return 0;
  }

  return {
    DEFAULT: DEFAULT, PRESETS: PRESETS, STRAIGHTS: STRAIGHTS,
    rankVal: rankVal, resolve: resolve, fromPreset: fromPreset,
    tributeCount: tributeCount
  };
});
