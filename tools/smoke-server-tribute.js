// 联机进贡无头冒烟（Task 3）：直接加载 server/index.js 内部函数，
// 驱动三个场景验证 独食被抽方向逐家交错 / 独食抽牌方向每败方上限 / 2v2 回归。
// 用法: node tools/smoke-server-tribute.js
const fs = require('fs');
const path = require('path');

const SERVER = path.join(__dirname, '..', 'server', 'index.js');
const src = fs.readFileSync(SERVER, 'utf8');
const cut = src.indexOf('// ---------- 启动');
if (cut < 0) { console.error('FAIL: 找不到启动截断点（server/index.js 的「启动」注释）'); process.exit(1); }

const GX = require(path.join(__dirname, '..', 'engine', 'index.js'));

const fakeRequire = (p) => {
  if (p === './ws.js') return { createServer: () => {} };
  if (p === '../engine/index.js') return GX;
  return require(p);
};

const body = src.slice(0, cut) +
  '\n;module.exports = { rooms: rooms, conns: conns, afterDeal: afterDeal, handle: handle, viewFor: viewFor };';
const mod = { exports: {} };
new Function('require', 'module', 'exports', 'process', body)(fakeRequire, mod, mod.exports, process);
const SRV = mod.exports;

let failures = 0;
function ok(cond, label) {
  console.log((cond ? '  PASS ' : '  FAIL ') + label);
  if (!cond) failures++;
}

function fakeConn() {
  const c = { id: 'c1', lastView: null, errs: [] };
  c.send = (obj) => {
    if (obj && obj.t === 'state') c.lastView = obj;
    else if (obj && obj.t === 'err') c.errs.push(obj.msg);
  };
  return c;
}

// 把 ♠3/♠A 换进指定座位的手牌（模拟独食者恒持身份牌）
function rigIdentity(game, seat) {
  [[3, 3], [3, 14]].forEach(([s, r]) => {
    for (let p = 0; p < 4; p++) {
      const idx = game.players[p].hand.findIndex((c) => c.s === s && c.r === r);
      if (idx < 0) continue;
      if (p === seat) return;
      const swapIdx = game.players[seat].hand.findIndex((c) => !(c.s === 3 && (c.r === 3 || c.r === 14)));
      const tmp = game.players[seat].hand[swapIdx];
      game.players[seat].hand[swapIdx] = game.players[p].hand[idx];
      game.players[p].hand[idx] = tmp;
      return;
    }
  });
}

function makeRoom(cfg, lastResult, humanSeat, seed) {
  const room = {
    id: 't1', hostSeat: 0,
    seats: [0, 1, 2, 3].map((i) => ({
      name: 'P' + (i + 1), ai: i !== humanSeat, ready: true,
      connId: i === humanSeat ? 'c1' : null
    })),
    rounds: 8, cfg, phase: 'deal', round: 2,
    scores: [0, 0, 0, 0],
    game: GX.Table.createRound({ seed: seed >>> 0, config: cfg }),
    lastResult, tribute: null, summary: false, deadline: 0, timer: null, lastEvent: ''
  };
  SRV.rooms.set(room.id, room);
  return room;
}

function cleanup(room) {
  if (room.timer) clearTimeout(room.timer);
  SRV.rooms.delete(room.id);
  SRV.conns.delete('c1');
}

function handSizes(room) { return room.game.players.map((p) => p.hand.length); }
function hasCard(room, seat, s, r) {
  return room.game.players[seat].hand.some((c) => c.s === s && c.r === r);
}
function lowestNonIdentity(room, seat, n, cfg) {
  return room.game.players[seat].hand.slice()
    .filter((c) => !GX.Tribute.isIdentity(c))
    .sort((a, b) => GX.Rules.rankVal(a.r, cfg.rankOrder) - GX.Rules.rankVal(b.r, cfg.rankOrder))
    .slice(0, n)
    .map((c) => ({ r: c.r, s: c.s }));
}

const cfg = GX.Rules.resolve(); // 默认 heavy

// ---------- 场景 1：独食第 4 名被抽方向（三家各抽 4）逐家交错 ----------
console.log('场景1: 独食被抽方向 interleave（lone=seat3 第4名, winners=[0,1,2], quota=4, seat1=真人）');
(function () {
  const room = makeRoom(cfg, { camp: { mode: 'lone', lone: 3 }, ranks: [0, 1, 2, 3], scores: [0, 0, 0, 0], winRanks: [] }, 1, 20261121);
  rigIdentity(room.game, 3);
  const conn = fakeConn();
  SRV.conns.set('c1', { conn, roomId: room.id, seat: 1, name: 'H' });

  SRV.afterDeal(room);
  ok(room.phase === 'tribute', '进贡阶段开启');
  const T = room.tribute;
  ok(T && T.pairQuota === 4, 'pairQuota=4 已挂到房间 tribute');
  ok(T && Array.isArray(T.plan.winners) && T.plan.winners.join() === '0,1,2', 'winners=[0,1,2]');
  // seat0(AI) 应已同步完成 抽4+还4 → 轮到 seat1(真人) 抽牌时独食牌池已回填 13
  ok(conn.lastView && conn.lastView.tribute && conn.lastView.tribute.myTurnToDraw === true, '轮到真人 seat1 抽牌');
  ok(conn.lastView.tribute.pairQuota === 4, 'view.tribute.pairQuota=4 已广播');
  ok((conn.lastView.tribute.pulledFrom || {})[3] === 4, 'pulledFrom[seat3]=4（AI 已抽 4 张）');
  ok(conn.lastView.seats[2].count === 13, '交错回填：真人开抽前独食牌池=13（AI 抽还已完成）');
  ok(handSizes(room).join() === '13,13,13,13', '此时四家仍各 13 张');

  // 真人抽 4 张（独食 seat3 相对 seat1 的 rel=2）
  for (let k = 0; k < 4; k++) SRV.handle(conn, { t: 'draw', seatRel: 2 });
  ok(room.phase === 'tribute' && room.tribute && room.tribute.stage === 'return', '抽满 4 张后进入该胜方还贡阶段');
  ok(handSizes(room).join() === '13,17,13,9', '抽后：seat1=17, 独食=9');
  ok(conn.lastView.tribute.need === 4, 'view 还贡 need=4（drawsDone 记账）');

  // 真人还 4 张最低非身份牌
  const give = lowestNonIdentity(room, 1, 4, cfg);
  SRV.handle(conn, { t: 'return', cards: give });
  // seat2(AI) 随后同步完成 抽4+还4 → finishTribute → play
  ok(room.phase === 'play', '全部胜方交错完成后进入出牌阶段');
  ok(handSizes(room).join() === '13,13,13,13', '终局四家各 13 张（双方恒 13）');
  ok(hasCard(room, 3, 3, 3) && hasCard(room, 3, 3, 14), '独食者仍持 ♠3/♠A（身份牌不可抽）');
  ok(room.game.turn === 3, '先出权=独食（被抽最大牌原主人）');
  const total = handSizes(room).reduce((a, b) => a + b, 0);
  ok(total === 52, '总牌数 52');
  cleanup(room);
})();

// ---------- 场景 2：独食第 1 名抽牌方向（独食抽三家各 4）每败方上限 ----------
console.log('场景2: 独食抽牌方向 per-loser cap（lone=seat0 第1名=真人, quota=4, losers=[1,2,3]）');
(function () {
  const room = makeRoom(cfg, { camp: { mode: 'lone', lone: 0 }, ranks: [0, 1, 2, 3], scores: [0, 0, 0, 0], winRanks: [] }, 0, 20261122);
  rigIdentity(room.game, 0);
  const conn = fakeConn();
  SRV.conns.set('c1', { conn, roomId: room.id, seat: 0, name: 'H' });

  SRV.afterDeal(room);
  ok(room.phase === 'tribute' && room.tribute && room.tribute.pairQuota === 4, '进贡开启 pairQuota=4');
  ok(room.tribute.plan.winners.join() === '0' && room.tribute.plan.losers.join() === '1,2,3', 'winners=[0] losers=[1,2,3]');
  ok(conn.lastView.tribute.need === 0 || conn.lastView.tribute.myTurnToDraw, '真人独食为抽牌方');

  // 从 seat2(rel=2) 抽 4 张 → 第 5 次应报 这家已抽满
  for (let k = 0; k < 4; k++) SRV.handle(conn, { t: 'draw', seatRel: 2 });
  ok((room.tribute.drawnFrom || {})[2] === 4, 'seat2 已被抽 4 张');
  SRV.handle(conn, { t: 'draw', seatRel: 2 });
  ok(conn.errs.indexOf('这家已抽满') >= 0, '抽满后再抽 seat2 → 报错"这家已抽满"');
  ok((room.tribute.drawnFrom || {})[2] === 4, '报错后 drawnFrom[2] 仍为 4（未执行抽牌）');

  // 继续抽 seat1 ×4、seat3 ×4 → 共 12 张 → 进入统一还贡
  for (let k = 0; k < 4; k++) SRV.handle(conn, { t: 'draw', seatRel: 1 });
  for (let k = 0; k < 4; k++) SRV.handle(conn, { t: 'draw', seatRel: 3 });
  ok(room.tribute && room.tribute.stage === 'return', '12 张抽满进入统一还贡（抽牌方向保持先全抽后统一还）');
  const pf = room.tribute.drawnFrom || {};
  ok(pf[1] === 4 && pf[2] === 4 && pf[3] === 4, '三家各被抽满配额 4');
  ok(handSizes(room).join() === '25,9,9,9', '独食抽后 25 张，三家各 9 张');
  ok(conn.lastView.tribute.need === 12, 'view 还贡 need=12');

  const give = lowestNonIdentity(room, 0, 12, cfg);
  SRV.handle(conn, { t: 'return', cards: give });
  ok(room.phase === 'play', '还贡完成进入出牌');
  ok(handSizes(room).join() === '13,13,13,13', '终局四家各 13 张（每家等量还对应被抽者）');
  const total = handSizes(room).reduce((a, b) => a + b, 0);
  ok(total === 52, '总牌数 52');
  cleanup(room);
})();

// ---------- 场景 3：2v2 双下回归（全 AI，shares=[2,2]，先全抽后统一还） ----------
console.log('场景3: 2v2 双下回归（全 AI, winners=[0,2], 各抽 2 还 2）');
(function () {
  const room = makeRoom(cfg, {
    camp: { mode: 'team', teamA: [0, 2], teamB: [1, 3] }, ranks: [0, 1, 2, 3], scores: [0, 0, 0, 0], winRanks: []
  }, -1, 20261123);
  SRV.afterDeal(room);
  ok(room.phase === 'play', '全 AI 同步完成进贡进入出牌');
  ok(handSizes(room).join() === '13,13,13,13', '2v2 还贡真实生效：四家各 13 张');
  const total = handSizes(room).reduce((a, b) => a + b, 0);
  ok(total === 52, '总牌数 52');
  cleanup(room);
})();

console.log(failures ? ('FAIL: ' + failures + ' 项未过') : 'ALL PASS');
process.exit(failures ? 1 : 0);
