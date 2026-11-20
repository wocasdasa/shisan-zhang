const GX = require("./engine/index.js");
const cfg = GX.Rules.resolve();
let bad = 0, lone = 0, rounds = 0;
for (let s = 1; s <= 400; s++) {
  const g = GX.Table.createRound({ seed: s, config: cfg });
  let steps = 0;
  while (!g.over && steps++ < 400) {
    const p = g.turn;
    const a = GX.AI2.decide(g, p, 1);
    if (a.type === "play") GX.Table.play(g, p, a.cards);
    else if (GX.Table.pass(g, p)) {
      const ok = GX.Moves.candidates(g.players[p].hand, cfg).filter(c => GX.Table.validate(g, p, c.cards) === null);
      if (ok.length) GX.Table.play(g, p, GX.Moves.lowest(ok).cards);
    }
  }
  const res = GX.Settle.settle(g);
  rounds++;
  if (res.camp.mode === "lone") lone++;
  const both = g.players.filter(pl => (pl.revealedCards || []).length === 2).length;
  if (res.camp.mode === "2v2" && both > 0) { bad++; console.log("异常局 seed=" + s + " 2v2 却有人持两张身份牌"); }
  if (res.camp.mode === "lone" && both !== 1) { bad++; console.log("异常局 seed=" + s + " 独食但标记数=" + both); }
}
console.log("局数=" + rounds + " 独食=" + lone + " 异常=" + bad);
