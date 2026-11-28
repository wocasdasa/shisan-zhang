// 云函数进贡无头冒烟（Task 4）：云函数依赖 wx-server-sdk 无法本地直跑，
// 这里 stub wx-server-sdk + 内存数据库，通过 exports.main 真实驱动云函数入口，
// 验证 独食抽牌方向每败方 cap 与记账 / 独食被抽方向逐家交错完成判据 / 2v2 回归。
// 用法: node tools/smoke-cloud-tribute.js
const path = require('path');

// ---------- wx-server-sdk stub（内存版） ----------
const store = new Map(); // roomId -> { data: <room>, updatedAt, lockAt }
const clone = (o) => JSON.parse(JSON.stringify(o));

const fakeDb = {
  createCollection: async () => ({}),
  collection: () => ({
    doc: (id) => ({
      get: async () => {
        const w = store.get(String(id));
        if (!w) throw new Error('not found');
        return { data: clone(w) };
      },
      update: async (body) => {
        const cur = store.get(String(id));
        if (!cur) return { stats: { updated: 0 } };
        store.set(String(id), Object.assign({}, cur, clone(body.data)));
        return { stats: { updated: 1 } };
      },
      set: async (body) => { store.set(String(id), clone(body.data)); return {}; },
      remove: async () => { store.delete(String(id)); return {}; }
    }),
    where: (q) => ({
      update: async (body) => {
        const cur = store.get(String(q._id));
        if (!cur || cur.lockAt !== q.lockAt) return { stats: { updated: 0 } };
        store.set(String(q._id), Object.assign({}, cur, clone(body.data)));
        return { stats: { updated: 1 } };
      }
    })
  })
};

let openid = 'h1';
const cloudStub = {
  DYNAMIC_CURRENT_ENV: 'smoke',
  init: () => {},
  database: () => fakeDb,
  getWXContext: () => ({ OPENID: openid })
};

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'wx-server-sdk') return cloudStub;
  return origLoad.apply(this, arguments);
};

const CF = require(path.join(__dirname, '..', 'minigame', 'cloudfunctions', 'gx13', 'index.js'));

let failures = 0;
function ok(cond, label) {
  console.log((cond ? '  PASS ' : '  FAIL ') + label);
  if (!cond) failures++;
}

async function call(event, oid) { openid = oid || 'h1'; return CF.main(event); }
async function state(id, oid) { return call({ action: 'state', room: id }, oid); }
function roomOf(id) { return clone(store.get(String(id)).data); }
function hackRoom(id, fn) {
  const w = store.get(String(id));
  const data = clone(w.data);
  fn(data);
  w.data = data;
}
function handSizes(room) { return room.game.players.map((p) => p.hand.length); }
function groupCount(list, key) {
  const out = {};
  list.forEach((d) => { out[d[key]] = (out[d[key]] || 0) + 1; });
  return out;
}
function hasCard(room, seat, s, r) {
  return room.game.players[seat].hand.some((c) => c.s === s && c.r === r);
}
// 把 ♠3/♠A 换进指定座位手牌（模拟独食者恒持身份牌）
function rigIdentity(room, seat) {
  [[3, 3], [3, 14]].forEach(([s, r]) => {
    for (let p = 0; p < 4; p++) {
      const idx = room.game.players[p].hand.findIndex((c) => c.s === s && c.r === r);
      if (idx < 0) continue;
      if (p === seat) return;
      const swapIdx = room.game.players[seat].hand.findIndex((c) => !(c.s === 3 && (c.r === 3 || c.r === 14)));
      const tmp = room.game.players[seat].hand[swapIdx];
      room.game.players[seat].hand[swapIdx] = room.game.players[p].hand[idx];
      room.game.players[p].hand[idx] = tmp;
      return;
    }
  });
}

(async function () {
  // ---------- 场景 1：独食第 1 名抽牌方向（真人手动抽，验证 cap 拦截与记账） ----------
  console.log('场景1: 独食抽牌方向 per-loser cap（lone=seat0 第1名=真人, quota=4, losers=[1,2,3]）');
  const created = await call({ action: 'create', rounds: 8, cfg: { testTribute: true }, name: 'H' });
  ok(created && created.t === 'joined', '建房成功');
  const rid = created.room;
  await call({ action: 'start', room: rid });
  hackRoom(rid, (r) => { r.deadline = 0; });
  let st = await state(rid);
  ok(st.phase === 'tribute', 'testTribute 发牌后进入进贡阶段');
  ok(st.tribute && st.tribute.pairQuota === 4, 'view.tribute.pairQuota=4');
  ok(st.tribute && st.tribute.pulledFrom && Object.keys(st.tribute.pulledFrom).length === 0, 'view.tribute.pulledFrom 初始为空');
  ok(st.tribute && st.tribute.myTurnToDraw === true, '轮到真人独食抽牌');

  // 摊牌（seatRel 任意：抽牌方向三家一起摊）
  await call({ action: 'drawPick', room: rid, seatRel: 1 });
  let room = roomOf(rid);
  ok(room.tributeShow.stage === 'pull', '摊牌后进入 pull 阶段');
  ok(room.tributeShow.total === 12, 'total=per×targets=4×3=12（修正 count×targets=36 的放大）');
  ok((room.tributeShow.targets || []).join(',') === '1,2,3', '抽牌方向 targets=三家');

  // 从 seat1 连抽：第 5 次起被 cap 拦截；身份牌亮还不计，循环直到抽满 4
  for (let k = 0; k < 20 && (roomOf(rid).tributeShow.pulledFrom[1] || 0) < 4; k++) {
    await call({ action: 'pullPick', room: rid, seatRel: 1, idx: k % 7 });
  }
  room = roomOf(rid);
  ok((room.tributeShow.pulledFrom[1] || 0) === 4, 'seat1 被抽满 4 张（身份牌亮还不计）');
  const sizesAfter4 = handSizes(room).join();
  for (let k = 0; k < 3; k++) await call({ action: 'pullPick', room: rid, seatRel: 1, idx: k });
  room = roomOf(rid);
  ok((room.tributeShow.pulledFrom[1] || 0) === 4, 'cap 拦截：seat1 抽满后再抽 pulledFrom 仍为 4');
  ok(handSizes(room).join() === sizesAfter4, 'cap 拦截后手牌数不变（未执行抽牌）');

  // 抽满 seat2、seat3 → 共 12 张 → 进入还贡
  for (let k = 0; k < 20 && (roomOf(rid).tributeShow.pulledFrom[2] || 0) < 4; k++) await call({ action: 'pullPick', room: rid, seatRel: 2, idx: k % 5 });
  for (let k = 0; k < 20 && (roomOf(rid).tributeShow.pulledFrom[3] || 0) < 4; k++) await call({ action: 'pullPick', room: rid, seatRel: 3, idx: k % 6 });
  room = roomOf(rid);
  const pf = room.tributeShow.pulledFrom;
  ok(pf[1] === 4 && pf[2] === 4 && pf[3] === 4, '三家各被抽满配额 4');
  ok(room.tributeShow.stage === 'return', '12 张抽满进入还贡（抽牌方向保持先全抽后统一还）');
  ok(room.tributeShow.draws.length === 12, 'draws 共 12 笔');
  ok(handSizes(room).join() === '25,9,9,9', '独食抽后 25 张，三家各 9 张');

  // 真人还 12 张（自动选最低非身份牌，逐张还给原主）
  for (let k = 0; k < 12; k++) await call({ action: 'retOne', room: rid, cards: [] });
  room = roomOf(rid);
  ok(room.tributeShow.stage === 'done', '还贡完成本轮结束');
  const retBy = groupCount(room.tributeShow.returned, 'to');
  ok(retBy[1] === 4 && retBy[2] === 4 && retBy[3] === 4, '还贡等量还给对应被抽者（各 4 张）');
  ok(handSizes(room).join() === '13,13,13,13', '终局四家各 13 张（双方恒 13）');
  // finishTribute 已设先出权（此刻 phase 仍 tribute，AI 尚未行动）
  ok([1, 2, 3].indexOf(room.game.turn) >= 0, '先出权=被抽最大牌原主人（三家之一）');

  hackRoom(rid, (r) => { r.tributeShow.deadline = 1; });
  st = await state(rid);
  ok(st.phase === 'play', '进贡收尾进入出牌');

  // ---------- 场景 2：独食第 3 名被抽方向（全 AI 逐家交错，验证完成判据非 freeLosers 空判） ----------
  console.log('场景2: 独食被抽方向 interleave（lone=seat0 第3名, winners=[1,2,3] 全 AI, quota=2）');
  const c2 = await call({ action: 'create', rounds: 8, cfg: {}, name: 'H' });
  const rid2 = c2.room;
  await call({ action: 'start', room: rid2 });
  hackRoom(rid2, (r) => {
    r.round = 2;
    r.phase = 'deal';
    r.deadline = 0;
    r.tributeShow = null;
    r.lastResult = { ranks: [1, 2, 0, 3], camp: { mode: 'lone', lone: 0, teamA: [], teamB: [] }, scores: [0, 0, 0, 0] };
    rigIdentity(r, 0); // 独食恒持 ♠3/♠A
  });
  st = await state(rid2);
  room = roomOf(rid2);
  ok(room.phase === 'tribute' && room.tributeShow && room.tributeShow.stage === 'done', '三位 AI 胜方逐家交错一轮内全部完成');
  ok(room.tributeShow.pairQuota === 2, 'pairQuota=2');
  const drawsByW = groupCount(room.tributeShow.draws, 'to');
  ok(drawsByW[1] === 2 && drawsByW[2] === 2 && drawsByW[3] === 2,
    '每位胜方各抽满 2 张（pulledFrom 跨轮累计到 2 后不误判完成）');
  ok((room.tributeShow.pulledFrom[0] || 0) === 6, 'pulledFrom[独食]=6（三家累计记账）');
  const retBy2 = groupCount(room.tributeShow.returned, 'to');
  ok(retBy2[0] === 6, '独食共收回 6 张还贡');
  ok(handSizes(room).join() === '13,13,13,13', '终局四家各 13 张（交错回填）');
  ok(hasCard(room, 0, 3, 3) && hasCard(room, 0, 3, 14), '独食者仍持 ♠3/♠A（身份牌不可抽）');
  hackRoom(rid2, (r) => { r.tributeShow.deadline = 1; });
  st = await state(rid2);
  ok(st.phase === 'play' && roomOf(rid2).game.turn === 0, '先出权=独食（被抽最大牌原主人）');

  // ---------- 场景 3：2v2 回归（pairQuota=null，行为零变化） ----------
  console.log('场景3: 2v2 双下回归（winners=[0,2], 各抽 2 还 2）');
  const c3 = await call({ action: 'create', rounds: 8, cfg: {}, name: 'H' });
  const rid3 = c3.room;
  await call({ action: 'start', room: rid3 });
  hackRoom(rid3, (r) => {
    r.round = 2;
    r.phase = 'deal';
    r.deadline = 0;
    r.tributeShow = null;
    r.lastResult = { ranks: [0, 1, 2, 3], camp: { mode: 'team', teamA: [0, 2], teamB: [1, 3] }, scores: [0, 0, 0, 0] };
  });
  st = await state(rid3);
  room = roomOf(rid3);
  ok(room.phase === 'tribute' && room.tributeShow && room.tributeShow.pairQuota === null, '2v2 pairQuota=null');
  ok(room.tributeShow.turnW === 0 && room.tributeShow.stage === 'draw', '轮到真人 seat0 摊牌');
  ok(room.tributeShow.total === undefined, '未摊牌前无 total');
  // 真人超时 → autoTribute 走 AI 路径完成本轮
  hackRoom(rid3, (r) => { r.tributeShow.deadline = 1; });
  st = await state(rid3);
  room = roomOf(rid3);
  ok(room.tributeShow.stage === 'done', '真人超时自动完成 + AI 胜方完成，进贡收尾');
  const byW3 = groupCount(room.tributeShow.draws, 'to');
  ok(byW3[0] === 2 && byW3[2] === 2, '两位胜方各抽 2 张（total=count×1 不变）');
  ok(handSizes(room).join() === '13,13,13,13', '2v2 还贡真实生效：四家各 13 张');
  ok(handSizes(room).reduce((a, b) => a + b, 0) === 52, '总牌数 52');

  console.log(failures ? ('FAIL: ' + failures + ' 项未过') : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
