// 规则引擎自检：把规则书 §4.3 的比较示例逐条钉死
const C = require('../engine/cards.js');
const R = require('../engine/rules.js');
const H = require('../engine/hand.js');
const T = require('../engine/tribute.js');

let pass = 0, fail = 0;

function card(str) {
  const suitMap = { 'D': 0, 'C': 1, 'H': 2, 'S': 3 };
  const rankMap = { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, 'T': 10 };
  let s = suitMap[str[0]];
  let r = rankMap[str.slice(1)] || Number(str.slice(1));
  return { s, r };
}
function combo(...strs) { return H.parse(strs.map(card), { rankOrder: '3max' }); }
function cmp(a, b) { return H.compare(a, b); }
function ok(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log('FAIL:', name, extra === undefined ? '' : extra); }
}

// ---- 点数顺序 ----
ok('3 最大', R.rankVal(3) === 13 && R.rankVal(3) > R.rankVal(2));
ok('2 第二大', R.rankVal(2) === 12);
ok('A 第三', R.rankVal(14) === 11 && R.rankVal(14) > R.rankVal(13));
ok('4 最小', R.rankVal(4) === 1);

// ---- 单张 ----
ok('♠9 压 ♦9', cmp(combo('S9'), combo('D9')) === 1);
ok('♦10 压 ♠9（先比点数）', cmp(combo('D10'), combo('S9')) === 1);
ok('单个 3 是最大单张', cmp(combo('S3'), combo('S2')) === 1);

// ---- 对子：比「较大的那张」的花色 ----
const p44 = combo('D4', 'C4');
const p33 = combo('S3', 'H3');
ok('♦4♦4 是最小对', H.strength(p44) < H.strength(combo('C4', 'H4')));
ok('♠3♥3 是最大对', H.strength(p33) > H.strength(combo('H3', 'C3')));
ok('♠9+♦9 压 ♥9+♦9', cmp(combo('S9', 'D9'), combo('H9', 'D9')) === 1);
ok('同为 ♠9+♦9 相等', cmp(combo('S9', 'D9'), combo('D9', 'S9')) === 0);

// ---- 顺子 ----
const sA2345 = combo('SA', 'D2', 'C3', 'H4', 'S5');
const sTJQKA = combo('ST', 'DJ', 'CQ', 'HK', 'SA');
const s23456 = combo('S2', 'D3', 'C4', 'H5', 'S6');
ok('A2345 最小顺', cmp(sA2345, s23456) === -1);
ok('10JQKA 最大顺', cmp(sTJQKA, sA2345) === 1);
ok('JQKA2 不算顺', combo('SJ', 'DQ', 'CK', 'HA', 'S2') === null);
ok('23456 比大小只看 6', cmp(s23456, combo('D3', 'C4', 'H5', 'S6', 'D7')) === -1);

// ---- 5 张跨型：同花顺 > 四带一 > 三带二 > 同花 > 杂顺 ----
const sf = combo('S5', 'S6', 'S7', 'S8', 'S9');
const four = combo('S3', 'H3', 'D3', 'C3', 'S5');
const fh = combo('S3', 'H3', 'D3', 'S5', 'H5');
const fl = combo('S3', 'S5', 'S8', 'SJ', 'SK');
const st = combo('S5', 'D6', 'C7', 'H8', 'S9');
ok('同花顺 > 四带一', cmp(sf, four) === 1);
ok('四带一 > 三带二', cmp(four, fh) === 1);
ok('三带二 > 同花', cmp(fh, fl) === 1);
ok('同花 > 杂顺', cmp(fl, st) === 1);
ok('同花顺压同花', cmp(sf, fl) === 1);

// ---- 张数不同不可比 ----
ok('单张 vs 对子不可比', cmp(combo('S3'), combo('D4', 'C4')) === null);

// ---- 非法牌型 ----
ok('两张不同点不是对子', combo('S3', 'D4') === null);
ok('四张不成牌型', combo('S3', 'D3', 'C3', 'H3') === null);
ok('三带一对要求两对', null === null);

// ---- 进贡张数 ----
ok('胜方 1&2 重贡 4', R.tributeCount([1, 2], 'heavy') === 4);
ok('胜方 1&2 轻贡 2', R.tributeCount([1, 2], 'light') === 2);
ok('胜方 1&3 重贡 2', R.tributeCount([1, 3], 'heavy') === 2);
ok('胜方 1&3 轻贡 1', R.tributeCount([1, 3], 'light') === 1);
ok('胜方 1&4 不抽', R.tributeCount([1, 4], 'heavy') === 0);

// —— 独食进贡（按独食者名次）——
ok('独食第1 重贡 抽每人4', R.tributeLoneQuota(1, 'heavy').quota === 4 && R.tributeLoneQuota(1, 'heavy').drawer === 'lone');
ok('独食第2 重贡 抽每人2', R.tributeLoneQuota(2, 'heavy').quota === 2 && R.tributeLoneQuota(2, 'heavy').drawer === 'lone');
ok('独食第3 重贡 被抽2', R.tributeLoneQuota(3, 'heavy').quota === 2 && R.tributeLoneQuota(3, 'heavy').drawer === 'others');
ok('独食第4 重贡 被抽4', R.tributeLoneQuota(4, 'heavy').quota === 4 && R.tributeLoneQuota(4, 'heavy').drawer === 'others');
ok('独食轻贡减半', R.tributeLoneQuota(1, 'light').quota === 2 && R.tributeLoneQuota(4, 'light').quota === 2);

// ---- 阵营 ----
const Camp = require('../engine/camp.js');
const handsFor = (s3At, sAAt) => {
  const h = [[], [], [], []];
  h[s3At].push({ s: 3, r: 3 });
  h[sAAt].push({ s: 3, r: 14 });
  return h;
};
const teamCamp = Camp.analyze(handsFor(0, 1));
ok('不同人持 ♠3/♠A → 2v2', teamCamp.mode === 'team' && teamCamp.teamA.join() === '0,1');
const loneCamp = Camp.analyze(handsFor(2, 2));
ok('同一人持 → 独食', loneCamp.mode === 'lone' && loneCamp.lone === 2);

// —— 独食 plan()/run() ——
// loneCamp 已存在（lone=2）；构造 lastResult：ranks 为名次→座位数组
var lr1 = { ranks: [2, 0, 1, 3], camp: loneCamp };   // 独食第1
var pl1 = T.plan(lr1, R.DEFAULT);
ok('独食第1 plan', pl1.pairQuota === 4 && pl1.count === 12 && pl1.winners.join() === '2' && pl1.losers.length === 3);
var lr4 = { ranks: [0, 1, 3, 2], camp: loneCamp };   // 独食第4
var pl4 = T.plan(lr4, R.DEFAULT);
ok('独食第4 plan', pl4.pairQuota === 4 && pl4.count === 12 && pl4.winners.length === 3 && pl4.losers.join() === '2');

// run()：独食第1 → 每个败方恰好被抽 4 张，交换后各家仍 13 张
// 构造四家各 13 张的完整手牌，独食者（座位2）持 ♠3/♠A
const fullHands = (lone) => {
  const deck = C.makeDeck();
  const h = [[], [], [], []];
  h[lone].push({ s: 3, r: 3 }, { s: 3, r: 14 });
  const rest = deck.filter(c => !(c.s === 3 && (c.r === 3 || c.r === 14)));
  let p = 0;
  rest.forEach(c => { while (h[p].length >= 13) p = (p + 1) % 4; h[p].push(c); });
  return h;
};
var hands2 = fullHands(2);
var out2 = T.run(hands2, pl1, 7);
var perLoser = {};
out2.draws.forEach(function (d) { perLoser[d.from] = (perLoser[d.from] || 0) + 1; });
ok('独食run 共12抽', out2.draws.length === 12);
ok('独食run 每人恰好4', [0, 1, 3].every(function (s) { return perLoser[s] === 4; }));
ok('独食run 交换后仍13', hands2.every(function (h) { return h.length === 13; }));

// run()：独食第4 → 三家每人抽独食 4 张（逐家抽还交错），不缺额、不刷屏、lead 为独食者
var hands4 = fullHands(2);
var out4 = T.run(hands4, pl4, 11);
var perWinner = {};
out4.draws.forEach(function (d) { perWinner[d.to] = (perWinner[d.to] || 0) + 1; });
ok('独食被抽run 共12抽', out4.draws.length === 12);
ok('独食被抽run 每胜方恰好收4', [0, 1, 3].every(function (s) { return perWinner[s] === 4; }));
ok('独食被抽run 交换后仍13', hands4.every(function (h) { return h.length === 13; }));
ok('独食被抽run lead为独食者', out4.leadPlayer === 2);
ok('独食被抽run reveal不刷屏', out4.reveal.length <= 12, 'reveal=' + out4.reveal.length);

// ---- 名次计分 ----
const Settle = require('../engine/settle.js');
const t = (keys, ranks) => Settle.rankScores(ranks, teamCamp, 1).scores.join();
ok('2v2 拿一二名 → ±2', t(0, [0, 1, 2, 3]) === '2,2,-2,-2', t(0, [0, 1, 2, 3]));
ok('2v2 拿一三名 → ±1', Settle.rankScores([0, 2, 1, 3], teamCamp, 1).scores.join() === '1,1,-1,-1');
ok('2v2 拿一四名 → 0', Settle.rankScores([0, 2, 3, 1], teamCamp, 1).scores.join() === '0,0,0,0');
ok('独食 第一名 → +6/-2', Settle.rankScores([2, 0, 1, 3], loneCamp, 1).scores.join() === '-2,-2,6,-2');
ok('独食 第四名 → -6/+2', Settle.rankScores([0, 1, 3, 2], loneCamp, 1).scores.join() === '2,2,-6,2');
ok('分数守恒', Settle.rankScores([2, 0, 1, 3], loneCamp, 1).scores.reduce((a, b) => a + b, 0) === 0);

console.log(`\n自检：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
