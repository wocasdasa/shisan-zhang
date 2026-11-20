// 补丁 v2 客户端：三家同时摊牌（一轮抽 3N）+ 逐张还贡
const fs = require('fs')
const path = require('path')

const appFile = path.resolve(__dirname, '..', 'minigame', 'js', 'app.js')
let app = fs.readFileSync(appFile, 'utf8')

// 1) view 映射：pull.rows / ret
app = app.replace(
  `        pull: T.pull || null,`,
  `        pull: T.pull || null,
        ret: T.ret || null,`
)
if (!app.includes('ret: T.ret || null')) throw new Error('ret map failed')

// 2) 摊牌多排：pullOne(rel, idx)
const OLD_PULL = `  // 摊牌后点第 idx 张：抽走一张
  function pullOne(idx) {
    var T = S.tribute;
    if (!T || T.stage !== 'pull' || !T.pull) return;
    if (S.mode === 'online') { NET.send({ t: 'pullPick', idx: idx }); return; }
    var p = T.pull.target;`

const NEW_PULL = `  // 摊牌后点某家第 idx 张：抽走一张
  function pullOne(rel, idx) {
    var T = S.tribute;
    if (!T || T.stage !== 'pull' || !T.pull) return;
    if (S.mode === 'online') { NET.send({ t: 'pullPick', seatRel: rel, idx: idx }); return; }
    var p = rel;`

if (!app.includes(OLD_PULL)) throw new Error('pullOne anchor missing')
app = app.replace(OLD_PULL, NEW_PULL)

// 本地抽满 → 进入逐张还贡
app = app.replace(
  `    T.pull.done++;
    T.pull.n = hand.length;
    SFX.play('play');
    if (T.pull.done >= T.need) {
      T.stage = 'return';
      S.hint = '选 ' + T.need + ' 张还贡';
    } else {
      S.hint = '再抽一张（' + T.pull.done + '/' + T.need + '）';
    }`,
  `    T.pull.done++;
    (T.pull.rows || []).forEach(function (r) { if (r.rel === p) r.n = hand.length; });
    SFX.play('play');
    if (T.pull.done >= (T.pull.total || T.need)) {
      // 抽满 → 还贡：按被抽走的牌从大到小，一张一张还
      var rq = (T.draws || []).slice(T.pull.roundStart || 0);
      rq.sort(function (a, b) {
        var d = (GX.Rules.rankVal(b.card.r, S.cfg.rankOrder) - GX.Rules.rankVal(a.card.r, S.cfg.rankOrder));
        return d || (a.card.s - b.card.s);
      });
      T.retQueue = rq;
      T.retIdx = 0;
      T.stage = 'return';
      S.hint = '逐张还贡（1/' + rq.length + '）';
    } else {
      S.hint = '再抽一张（' + T.pull.done + '/' + (T.pull.total || T.need) + '）';
    }`
)

// 3) 逐张还贡（本地 / 在线）
app = app.replace(
  `  function confirmReturn() {`,
  `  function returnTributeCard(c) {
    var T = S.tribute;
    if (!T || T.stage !== 'return' || !c) return false;
    if (S.mode === 'online') {
      NET.send({ t: 'retOne', cards: [{ r: c.r, s: c.s }] });
      return true;
    }
    var cur = (T.retQueue || [])[T.retIdx];
    if (!cur) return true;
    var hand = S.game.players[0].hand;
    var idx = hand.findIndex(function (x) { return x.r === c.r && x.s === c.s; });
    if (idx < 0) return true;
    hand.splice(idx, 1);
    S.game.players[cur.from].hand.push(c);
    sortHand(hand);
    T.returned.push({ from: 0, to: cur.from, card: c });
    T.log.push({ text: '还 ' + suitRank(c) + ' 给 ' + SEAT_NAMES[cur.from], kind: 'ret' });
    T.retIdx++;
    SFX.play('play');
    if (T.retIdx >= (T.retQueue || []).length) {
      T.stage = 'done';
      finishTribute();
    } else {
      S.hint = '逐张还贡（' + (T.retIdx + 1) + '/' + T.retQueue.length + '）';
    }
    P.markDirty();
    return true;
  }

  function confirmReturn() {`
)

// 4) onTap：还贡阶段点手牌 = 直接还这一张
app = app.replace(
  `        if (h.act === 'card') {
          var c0 = handCardAt(h.i);
          if (c0) {`,
  `        if (h.act === 'card') {
          var c0 = handCardAt(h.i);
          if (c0 && S.tribute && S.tribute.stage === 'return') { returnTributeCard(c0); return; }
          if (c0) {`
)

// 5) pullCard 带排
app = app.replace(
  `    if (h.act === 'pullCard') { pullOne(h.idx); return; }`,
  `    if (h.act === 'pullCard') { pullOne(h.p, h.idx); return; }`
)

// 6) 点座位开牌堆：本地多排
app = app.replace(
  `    T.stage = 'pull';
    T.pull = { target: p, n: S.game.players[p].hand.length, done: 0, count: T.need };`,
  `    T.stage = 'pull';
    var losersAll = (T.plan && T.plan.losers) || [p];
    var rows = losersAll.map(function (r) { return { rel: r, n: S.game.players[r].hand.length }; });
    T.pull = { rows: rows, done: 0, total: T.need * rows.length, count: T.need, roundStart: (T.draws || []).length };`
)

fs.writeFileSync(appFile, app, 'utf8')

// ---------------- views.js：多排摊牌 + 还贡进度条 ----------------
const viewFile = path.resolve(__dirname, '..', 'minigame', 'js', 'views.js')
let v = fs.readFileSync(viewFile, 'utf8')

const P0 = v.indexOf(`    // 摊牌：被抽者整手牌背面朝上摊成一排`)
const P1 = v.indexOf(`  // ---------- 结算 ----------`, P0)
if (P0 < 0 || P1 < 0) throw new Error('pull render anchor missing')

const newPull = `    // 摊牌：被抽者整手牌背面朝上摊开（独食三家同时摊三排），点任意一张抽走
    if (T.stage === 'pull' && T.pull && T.pull.rows) {
      var rows = T.pull.rows;
      var rowGap = 30;
      var rowH = 58;
      var blockH = rows.length * rowH + (rows.length - 1) * rowGap;
      var top = L.center.y - blockH / 2 - 6;

      rows.forEach(function (row, ri) {
        var n = Math.max(1, row.n);
        var gp2 = 7;
        var avail = Math.min(W - 300, 520);
        var pw = Math.floor((avail - (n - 1) * gp2) / n);
        pw = Math.max(20, Math.min(38, pw));
        var phh = Math.round(pw * 1.38);
        var totalW = n * pw + (n - 1) * gp2;
        var sx = W / 2 - totalW / 2 + 70;
        var sy = top + ri * (rowH + rowGap);

        box(ctx, 40, sy - 6, 96, phh + 12, 10, 'rgba(6,26,18,0.6)', 'rgba(201,169,97,0.28)');
        txt(ctx, SEAT_NAMES[row.rel], 88, sy + phh / 2 - 6, 14, C.gold, 'center', 600);
        txt(ctx, row.n + ' 张', 88, sy + phh / 2 + 12, 12, C.dim, 'center');

        for (var i = 0; i < n; i++) {
          var cx2 = sx + i * (pw + gp2);
          drawBack(ctx, cx2, sy, pw, phh);
          hits.push({ x: cx2 - 2, y: sy - 4, w: pw + 4, h: phh + 8, act: 'pullCard', p: row.rel, idx: i });
        }
      });

      var doneTxt = '已抽 ' + (T.pull.done || 0) + ' / ' + (T.pull.total || 0) + ' 张';
      txt(ctx, doneTxt, W / 2, top + blockH + 20, 12.5, C.dim, 'center');
    }
  }

`
v = v.slice(0, P0) + newPull + v.slice(P1)

// 去掉旧的收尾大括号（原函数尾部多了一个 }）
v = v.replace(`      txt(ctx, '抽到的牌会亮在他头像旁，所有人都看得到', W / 2, sy + phh + 22, 12, C.dim, 'center');
    }
  }

  // ---------- 结算 ----------`, `  // ---------- 结算 ----------`)

fs.writeFileSync(viewFile, v, 'utf8')
console.log('client patched v2: 多排摊牌 + 逐张还贡')
