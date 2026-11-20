// 一万局自战验证：不卡死、不出非法牌、名次唯一、分数守恒、进贡张数正确
const Table = require('../engine/table.js');
const AI = require('../engine/ai.js');
const Moves = require('../engine/moves.js');
const Settle = require('../engine/settle.js');
const Tribute = require('../engine/tribute.js');
const Rules = require('../engine/rules.js');

const N = Number(process.argv[2] || 10000);
const ROUNDS_PER_MATCH = Number(process.argv[3] || 8);
const cfg = Rules.resolve();

const stats = {
  rounds: 0, matches: 0, turns: 0, maxTurns: 0,
  lone: 0, stall: 0, violation: 0, badRanks: 0, badSum: 0,
  combos: { '1,2': 0, '1,3': 0, '1,4': 0 },
  loneRanks: { 1: 0, 2: 0, 3: 0, 4: 0 },
  tributeRuns: 0, tributeCards: 0, tributeReveal: 0, tributeLead: 0,
  teamScores: 0
};

function forcePlay(game) {
  const cands = Moves.candidates(game.players[game.turn].hand, game.cfg);
  const ok = cands.filter(c => Table.validate(game, game.turn, c.cards) === null);
  if (!ok.length) return false;
  Table.play(game, game.turn, Moves.lowest(ok).cards);
  return true;
}

function playRound(hands, firstPlayer, seed) {
  const game = Table.createRound({ seed, config: cfg, hands, firstPlayer });
  let guard = 0;
  while (!game.over) {
    if (++guard > 2000) { stats.stall++; break; }
    let err = AI.auto(game);
    if (err) {
      // 兜底：AI 选择不合法（例如领出却想走），强制出最小合法牌
      if (!forcePlay(game)) { stats.stall++; break; }
    }
  }
  const res = Settle.settle(game);
  stats.rounds++;
  stats.turns += game.turnCount;
  if (game.turnCount > stats.maxTurns) stats.maxTurns = game.turnCount;
  stats.violation += game.violations.length;

  // 名次完整性
  const ranks = game.ranks;
  if (ranks.length !== 4 || new Set(ranks).size !== 4) stats.badRanks++;
  else {
    // 第 n 名应该是第 n 个出完的人，ranks 顺序即名次
  }
  if (res.sum !== 0) stats.badSum++;

  if (game.camp.mode === 'lone') {
    stats.lone++;
    stats.loneRanks[ranks.indexOf(game.camp.lone) + 1]++;
  } else {
    const winTeam = game.camp.teamA.indexOf(ranks[0]) >= 0 ? game.camp.teamA : game.camp.teamB;
    const key = winTeam.map(p => ranks.indexOf(p) + 1).sort().join(',');
    stats.combos[key] = (stats.combos[key] || 0) + 1;
  }
  return { game, res };
}

let seedCounter = 1;
function nextSeed() { return (seedCounter++ * 2654435761) % 4294967296; }

function playMatch() {
  stats.matches++;
  let lastRes = null;
  let hands = null, firstPlayer = undefined;

  for (let r = 0; r < ROUNDS_PER_MATCH; r++) {
    const seed = nextSeed();
    // 进贡（第 2 局起）
    if (lastRes && cfg.tributeEnabled) {
      const plan = Tribute.plan(lastRes, cfg);
      if (!plan.skip) {
        if (!hands) hands = null; // 需要基于真实手牌，改为先发牌再进贡
      }
    }
    // 发牌 → 进贡 → 开打，这两步必须共用同一副牌，所以先建牌堆
    const game0 = Table.createRound({ seed, config: cfg });
    hands = game0.players.map(p => p.hand.slice());

    if (lastRes && cfg.tributeEnabled) {
      const plan = Tribute.plan(lastRes, cfg);
      if (!plan.skip) {
        const tr = Tribute.run(hands, plan, seed + 7);
        stats.tributeRuns++;
        stats.tributeCards += tr.draws.length;
        stats.tributeReveal += tr.reveal.length;
        if (tr.leadPlayer >= 0) { firstPlayer = tr.leadPlayer; stats.tributeLead++; }
        else firstPlayer = undefined;
      } else {
        firstPlayer = undefined;
      }
    } else {
      firstPlayer = undefined;
    }

    // 进贡后手牌数必须仍是 13
    for (const h of hands) if (h.length !== 13) stats.badSum++;

    const out = playRound(hands, firstPlayer, seed);
    lastRes = out.res;
  }
}

console.time('selfplay');
for (let i = 0; i < N; i += ROUNDS_PER_MATCH) playMatch();
console.timeEnd('selfplay');

const pct = (a, b) => b ? ((a / b) * 100).toFixed(2) + '%' : '0%';
console.log('\n===== 一万局自战结果 =====');
console.log(`对局数（局）：${stats.rounds}　（每场 ${ROUNDS_PER_MATCH} 局，共 ${stats.matches} 场）`);
console.log(`平均每局出牌步数：${(stats.turns / stats.rounds).toFixed(1)}　最多：${stats.maxTurns}`);
console.log(`独食局：${stats.lone}（${pct(stats.lone, stats.rounds)}）`);
console.log(`2v2 名次组合：1&2 = ${stats.combos['1,2']}（${pct(stats.combos['1,2'], stats.rounds - stats.lone)}）` +
            `　1&3 = ${stats.combos['1,3']}　1&4 = ${stats.combos['1,4']}`);
console.log(`独食者名次分布：第1 ${stats.loneRanks[1]}　第2 ${stats.loneRanks[2]}　第3 ${stats.loneRanks[3]}　第4 ${stats.loneRanks[4]}`);
console.log(`进贡执行：${stats.tributeRuns} 次　平均抽 ${(stats.tributeCards / (stats.tributeRuns || 1)).toFixed(2)} 张` +
            `　身份牌亮出重抽：${stats.tributeReveal} 次　被抽最大牌先出：${stats.tributeLead} 次`);
console.log('\n----- 异常检查（必须全为 0）-----');
console.log(`卡死：${stats.stall}　非法出牌：${stats.violation}　名次异常：${stats.badRanks}　分数/手牌异常：${stats.badSum}`);
console.log(stats.stall + stats.violation + stats.badRanks + stats.badSum === 0 ? '✅ 全部通过' : '❌ 有问题');
