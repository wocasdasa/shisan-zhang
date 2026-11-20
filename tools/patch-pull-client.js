// 补丁：客户端接入「摊牌手选」——点座位摊牌 → 点牌背抽一张 → 还贡
const fs = require('fs')
const path = require('path')

const appFile = path.resolve(__dirname, '..', 'minigame', 'js', 'app.js')
let app = fs.readFileSync(appFile, 'utf8')

// 1) view 映射补 pull
app = app.replace(
  `        canDraw: T.canDraw || [],`,
  `        canDraw: T.canDraw || [],
        pull: T.pull || null,
        targetRel: (typeof T.targetRel === 'number') ? T.targetRel : -1,`
)
if (!app.includes('pull: T.pull || null')) throw new Error('pull map failed')

// 2) 点座位：只摊牌，不直接抽
const OLD_SEAT = `  function drawFromSeat(p) {
    if (S.mode === 'online') {
      var TV = S.tribute;
      if (!TV || TV.stage !== 'draw') return;
      if ((TV.canDraw || []).indexOf(p) < 0) { toast('这个人已经抽过了'); return; }
      NET.send({ t: 'drawPick', seatRel: p });
      return;
    }
    var T = S.tribute;
    if (!T || T.stage !== 'draw' || !T.humanIsWinner) return;
    if (T.humanDrawn.length >= T.need) return;
    if (T.plan.losers.indexOf(p) < 0) { toast('只能从败方手里抽'); return; }`

const NEW_SEAT = `  function drawFromSeat(p) {
    var T = S.tribute;
    if (!T || T.stage !== 'draw') return;
    if (T.plan && T.plan.losers && T.plan.losers.indexOf(p) < 0) { toast('只能从败方手里抽'); return; }
    if (S.mode === 'online') {
      if ((T.canDraw || []).indexOf(p) < 0) { toast('这个人已经抽过了'); return; }
      NET.send({ t: 'drawPick', seatRel: p });
      return;
    }
    if (!T.humanIsWinner) return;
    if ((T.humanDrawn || []).length >= (T.need || 0)) return;
    T.stage = 'pull';
    T.pull = { target: p, n: S.game.players[p].hand.length, done: 0, count: T.need };
    S.hint = '点牌背抽一张';
    P.markDirty();
    return;
  }

  // 摊牌后点第 idx 张：抽走一张
  function pullOne(idx) {
    var T = S.tribute;
    if (!T || T.stage !== 'pull' || !T.pull) return;
    if (S.mode === 'online') { NET.send({ t: 'pullPick', idx: idx }); return; }
    var p = T.pull.target;
    var hand = S.game.players[p].hand;
    if (!hand.length) return;
    var k = Math.max(0, Math.min(idx, hand.length - 1));
    var c = hand[k];
    if (GX.Tribute.isIdentity(c)) {
      T.reveals.push({ owner: p, card: c });
      T.log.push({ text: SEAT_NAMES[p] + ' 的 ' + suitRank(c) + ' 是身份牌，亮出归还后重抽', kind: 'warn' });
      S.game.players[p].revealed = true;
      S.game.players[p].revealedCards = (S.game.players[p].revealedCards || []).concat([c.r]);
      S.game.players[p].revealedCard = c.r;
      P.markDirty();
      return;
    }
    hand.splice(k, 1);
    S.game.players[0].hand.push(c);
    sortHand(S.game.players[0].hand);
    T.draws.push({ from: p, to: 0, card: c });
    T.humanDrawn.push({ from: p, card: c });
    T.log.push({ text: '从 ' + SEAT_NAMES[p] + ' 抽到 ' + suitRank(c), kind: 'draw' });
    T.pull.done++;
    T.pull.n = hand.length;
    SFX.play('play');
    if (T.pull.done >= T.need) {
      T.stage = 'return';
      S.hint = '选 ' + T.need + ' 张还贡';
    } else {
      S.hint = '再抽一张（' + T.pull.done + '/' + T.need + '）';
    }
    P.markDirty();
    return;
  }`

if (!app.includes(OLD_SEAT)) throw new Error('drawFromSeat anchor missing')
app = app.replace(OLD_SEAT, NEW_SEAT)

// 3) handleAct 增加 pullCard
app = app.replace(
  `    if (h.act === 'drawSeat') { drawFromSeat(h.p); return; }`,
  `    if (h.act === 'drawSeat') { drawFromSeat(h.p); return; }
    if (h.act === 'pullCard') { pullOne(h.idx); return; }`
)

// 4) demo：直接开局即进贡（人类胜方，可完整走摊牌→点牌→还贡）
app = app.replace(
  `  // 仅预览用：直接渲染进贡面板，便于核对排版
  function demoTribute() {`,
  `  // 仅预览用：开局直接进贡（可交互：点座位 → 摊牌 → 点牌背 → 还贡）
  function demoPullTest() {
    S.mode = 'solo';
    S.round = 2;
    S.rounds = 8;
    S.cfg.tributeEnabled = true;
    S.game = GX.Table.createRound({ seed: 99, config: S.cfg });
    S.scores = [0, 0, 0, 0];
    S.phase = 'tribute';
    S.hint = '点金框对手的座位';
    S.selected = [];
    S.tribute = {
      plan: { count: 2, winners: [0, 2], losers: [1, 3], winnerRanks: [1, 3], skip: false },
      draws: [], reveals: [], log: [], shares: [2, 2],
      need: 2, stage: 'draw', canDraw: [1, 3], turnW: 0, picks: [], returned: [],
      pull: null, humanIsWinner: true, humanDrawn: [], t0: Date.now()
    };
    P.markDirty();
  }

  // 仅预览用：直接渲染进贡面板，便于核对排版
  function demoTribute() {`
)

// 5) boot demo 分支
app = app.replace(
  `      /demo=tributeSeq/.test(window.location.search || '')) {`,
  `      /demo=pullTest/.test(window.location.search || '')) {
      demoPullTest();
      return;
    }
    if (typeof window !== 'undefined' && window.location &&
      /demo=tributeSeq/.test(window.location.search || '')) {`
)

fs.writeFileSync(appFile, app, 'utf8')

// ---------------- views.js：进贡改成底部条 + 中央摊牌 ----------------
const viewFile = path.resolve(__dirname, '..', 'minigame', 'js', 'views.js')
let v = fs.readFileSync(viewFile, 'utf8')

const T0 = v.indexOf('  function tribute(ctx, S, L, hits) {')
const T1 = v.indexOf('  // ---------- 结算 ----------', T0)
if (T0 < 0 || T1 < 0) throw new Error('tribute fn anchor missing')

const newTribute = `  function tribute(ctx, S, L, hits) {
    var T = S.tribute;
    if (!T) return;
    var land = L.landscape;
    var H = L.H;

    var barH = 44;
    var barW = Math.min(W - 56, 700);
    var barX = (W - barW) / 2;
    var barY = L.hand.y - 56;

    // 底部状态条（不遮挡牌桌中央）
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 14;
    box(ctx, barX, barY, barW, barH, 14, 'rgba(8,30,22,0.96)', 'rgba(201,169,97,0.4)');
    ctx.restore();

    var cnt = (T.pull && T.pull.count) || T.need || (T.plan && T.plan.count) || 0;
    var prog = '进贡完成';
    if (T.stage === 'draw') prog = T.humanIsWinner ? '点金框的对手抽牌' : '等待对手抽牌';
    else if (T.stage === 'pull') prog = '选一张抽走（' + ((T.pull && T.pull.done) || 0) + '/' + cnt + '）';
    else if (T.stage === 'return') prog = '选 ' + cnt + ' 张还贡';

    txt(ctx, '第 ' + S.round + ' 局 · 进贡', barX + 16, barY + barH / 2, 15, C.gold, 'left', 600);
    txt(ctx, prog, barX + barW / 2 - 40, barY + barH / 2, 15, C.text, 'center', 600);

    // 还贡按钮（做成出牌那种胶囊）
    if (T.stage === 'return') {
      var bww = 148, bhh = 34;
      var bxx = barX + barW - bww - 8, byy = barY + (barH - bhh) / 2;
      var gd2 = ctx.createLinearGradient(0, byy, 0, byy + bhh);
      gd2.addColorStop(0, '#f7dc86');
      gd2.addColorStop(0.55, '#e9b84d');
      gd2.addColorStop(1, '#cf9a2f');
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.32)';
      ctx.shadowBlur = 8;
      box(ctx, bxx, byy, bww, bhh, bhh / 2, gd2, 'rgba(255,255,255,0.4)');
      ctx.restore();
      txt(ctx, '确认还贡', bxx + bww / 2, byy + bhh / 2 + 1, 15, '#3b2a08', 'center', 700);
      hits.push({ x: bxx, y: byy, w: bww, h: bhh, act: 'confirmReturn' });
    }

    // 最近一条公示：谁被抽走了什么，所有人都能看到
    var lastLog = (T.log || []).slice(-1)[0];
    if (lastLog) {
      txt(ctx, lastLog.text, W / 2, barY - 15, 12.5,
        lastLog.kind === 'warn' ? '#f3b7b2' : C.dim, 'center');
    }

    // 摊牌：被抽者整手牌背面朝上摊成一排，抽牌者点位置抽（点哪张由服务端洗牌决定随机）
    if (T.stage === 'pull' && T.pull) {
      var n = Math.max(1, T.pull.n || 1);
      var gp2 = 9;
      var avail = Math.min(W - 220, 640);
      var pw = Math.floor((avail - (n - 1) * gp2) / n);
      pw = Math.max(26, Math.min(50, pw));
      var phh = Math.round(pw * 1.38);
      var totalW = n * pw + (n - 1) * gp2;
      var sx = W / 2 - totalW / 2;
      var sy = L.center.y - phh / 2;

      txt(ctx, SEAT_NAMES[T.pull.target] + ' 的牌（背面朝上，点一张抽走）',
        W / 2, sy - 24, 14, C.text, 'center', 600);

      for (var i = 0; i < n; i++) {
        var cx2 = sx + i * (pw + gp2);
        drawBack(ctx, cx2, sy, pw, phh);
        // 可点范围略微放大，方便手指点
        hits.push({ x: cx2 - 2, y: sy - 4, w: pw + 4, h: phh + 8, act: 'pullCard', idx: i });
      }

      txt(ctx, '抽到的牌会亮在他头像旁，所有人都看得到', W / 2, sy + phh + 22, 12, C.dim, 'center');
    }
  }

`
v = v.slice(0, T0) + newTribute + v.slice(T1)

fs.writeFileSync(viewFile, v, 'utf8')
console.log('client patched: 摊牌手选 + 顶部公示 + 底部状态条')
