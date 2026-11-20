// 对照实验：同一批牌局，分别用「各打各的 AI」与「队友让牌 AI」
const Table = require('../engine/table.js');
const AI = require('../engine/ai.js');
const AI2 = require('../engine/ai2.js');
const Moves = require('../engine/moves.js');
const Settle = require('../engine/settle.js');
const Rules = require('../engine/rules.js');

const N = Number(process.argv[2] || 2000);
const cfg = Rules.resolve();

// 固定种子序列，两版跑同一副牌
const seeds = [];
for (let i = 1; i <= N; i++) seeds.push((i * 2654435761) % 4294967296);

function runSet(aiModule) {
  const st = {
    rounds: 0, turns: 0, passes: 0, plays: 0,
    loneRounds: 0, loneFirst: 0, loneEv: 0,
    combo: { '1,2': 0, '1,3': 0, '1,4': 0 },
    violation: 0, stall: 0, maxTurns: 0
  };

  for (const seed of seeds) {
    const game = Table.createRound({ seed, config: cfg });
    let guard = 0;
    while (!game.over) {
      if (++guard > 2000) { st.stall++; break; }
      const err = aiModule.auto(game);
      if (err) {
        const cands = Moves.candidates(game.players[game.turn].hand, cfg);
        const ok = cands.filter(c => Table.validate(game, game.turn, c.cards) === null);
        if (!ok.length) { st.stall++; break; }
        Table.play(game, game.turn, Moves.lowest(ok).cards);
      }
    }
    const res = Settle.settle(game);
    st.rounds++;
    st.turns += game.turnCount;
    if (game.turnCount > st.maxTurns) st.maxTurns = game.turnCount;
    st.violation += game.violations.length;
    game.history.forEach(h => { if (h.type === 'pass') st.passes++; if (h.type === 'play') st.plays++; });

    if (game.camp.mode === 'lone') {
      st.loneRounds++;
      const r = game.ranks.indexOf(game.camp.lone) + 1;
      if (r === 1) st.loneFirst++;
      st.loneEv += res.scores[game.camp.lone];
    } else {
      const winTeam = game.camp.teamA.indexOf(game.ranks[0]) >= 0 ? game.camp.teamA : game.camp.teamB;
      const key = winTeam.map(p => game.ranks.indexOf(p) + 1).sort().join(',');
      st.combo[key]++;
    }
  }
  return st;
}

function report(name, st) {
  const teamRounds = st.rounds - st.loneRounds;
  const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '—';
  console.log(`\n【${name}】`);
  console.log(`  局数 ${st.rounds}　平均步数 ${(st.turns / st.rounds).toFixed(1)}　最多 ${st.maxTurns}`);
  console.log(`  出牌 ${st.plays} 次　过牌 ${st.passes} 次（过牌率 ${pct(st.passes, st.plays + st.passes)}）`);
  console.log(`  独食局 ${st.loneRounds}（${pct(st.loneRounds, st.rounds)}）　独食者拿第一 ${pct(st.loneFirst, st.loneRounds)}　独食者场均 ${(st.loneEv / (st.loneRounds || 1)).toFixed(2)} 分`);
  console.log(`  2v2 名次：1&2 ${pct(st.combo['1,2'], teamRounds)}　1&3 ${pct(st.combo['1,3'], teamRounds)}　1&4 ${pct(st.combo['1,4'], teamRounds)}`);
  console.log(`  非法 ${st.violation}　卡死 ${st.stall}`);
  return st;
}

const a = report('A. 各打各的 AI（现状）', runSet(AI));
const b = report('B. 队友让牌 AI', runSet(AI2));

console.log('\n===== 差异 =====');
const d = (x, y, label, unit = '') => {
  const diff = y - x;
  const sign = diff > 0 ? '+' : '';
  console.log(`${label}：${x.toFixed(2)}${unit} → ${y.toFixed(2)}${unit}（${sign}${diff.toFixed(2)}${unit}）`);
};
d(a.loneFirst / a.loneRounds * 100, b.loneFirst / b.loneRounds * 100, '独食者胜率', '%');
d(a.loneEv / a.loneRounds, b.loneEv / b.loneRounds, '独食者场均得分', ' 分');
d(a.turns / a.rounds, b.turns / b.rounds, '平均步数', ' 步');
d(a.passes / (a.plays + a.passes) * 100, b.passes / (b.plays + b.passes) * 100, '过牌率', '%');
d(a.combo['1,4'] / (a.rounds - a.loneRounds) * 100, b.combo['1,4'] / (b.rounds - b.loneRounds) * 100, '一四名零分局占比', '%');
