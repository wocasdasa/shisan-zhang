// 各类弹层：进贡、结算、菜单、大厅、房间、聊天、工具抽屉、战绩、复盘、引导
// 依赖 views/base.js（由 views.js 拆分而来，函数体保持原样）
module.exports = function (B) {
  // 同名接住上层导出，函数体保持原样
  var state = B.state; // 共享可变状态，改的是 state 上的字段
  var C = B.C;
  var GUIDE_PAGES = B.GUIDE_PAGES;
  var SEAT_NAMES = B.SEAT_NAMES;
  var SUIT = B.SUIT;
  var box = B.box;
  var drawBack = B.drawBack;
  var easeOut = B.easeOut;
  var fxProgress = B.fxProgress;
  var overlay = B.overlay;
  var rankText = B.rankText;
  var rr = B.rr;
  var txt = B.txt;

  function tribute(ctx, S, L, hits) {
    var T = S.tribute;
    if (!T) return;
    var land = L.landscape;
    var H = L.H;

    var barH = 44;
    var barW = Math.min(state.W - 56, 700);
    var barX = (state.W - barW) / 2;
    var barY = L.hand.y - 56;

    // 底部状态条（不遮挡牌桌中央）
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 14;
    box(ctx, barX, barY, barW, barH, 14, 'rgba(10,20,34,0.96)', 'rgba(216,179,106,0.4)');
    ctx.restore();

    var cnt = (T.pull && (T.pull.total || T.pull.count)) || T.need || (T.plan && T.plan.count) || 0;
    var retTotal = (T.ret && T.ret.total) || (T.retQueue || []).length || 0;
    var retIdx = (T.ret && typeof T.ret.idx === 'number') ? T.ret.idx : (T.retIdx || 0);
    var retFrom = (T.ret && typeof T.ret.curFrom === 'number') ? T.ret.curFrom
      : ((T.retQueue && T.retQueue[T.retIdx]) ? T.retQueue[T.retIdx].from : -1);
    var prog = '进贡完成';
    if (T.stage === 'draw') prog = T.humanIsWinner
      ? ('点金框的对手抽牌' + (T.drawNeed ? '（还差 ' + T.drawNeed + ' 张）' : ''))
      : '等待对手抽牌';
    else if (T.stage === 'pull') prog = '点牌背抽牌（' + ((T.pull && T.pull.done) || 0) + '/' + cnt + '）';
    else if (T.stage === 'return') {
      if (state.mode === 'online') {
        prog = (T.need || 0) > 0
          ? ('选 ' + T.need + ' 张还贡' + ((S.selected || []).length ? ' · 已选 ' + S.selected.length + ' 张' : ''))
          : '等待对方还贡';
      } else {
        prog = '还贡 ' + Math.min(retIdx + 1, retTotal) + '/' + retTotal + ' → 还给 ' + (retFrom >= 0 ? SEAT_NAMES[retFrom] : '')
          + ((S.selected || []).length ? ' · 已选 ' + S.selected.length + ' 张' : '');
      }
    }

    txt(ctx, '第 ' + S.round + ' 局 · 进贡', barX + 16, barY + barH / 2, 15, C.gold, 'left', 600);
    txt(ctx, prog, barX + barW / 2 - 40, barY + barH / 2, 15, C.text, 'center', 600);

    // 还贡按钮（做出牌那种胶囊）：勾选完点这里才提交
    if (T.stage === 'return' && !(state.mode === 'online' && (T.need || 0) === 0)) {
      var selN = (S.selected || []).length;
      var bww = 148, bhh = 32;
      var bxx = barX + barW - bww - 8, byy = barY + (barH - bhh) / 2;
      var gd2 = ctx.createLinearGradient(0, byy, 0, byy + bhh);
      if (selN > 0) {
        gd2.addColorStop(0, '#f7dc86');
        gd2.addColorStop(0.55, '#e9b84d');
        gd2.addColorStop(1, '#cf9a2f');
      } else {
        gd2.addColorStop(0, '#9fb0c4');
        gd2.addColorStop(1, '#7e8ea3');
      }
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.28)';
      ctx.shadowBlur = 8;
      box(ctx, bxx, byy, bww, bhh, bhh / 2, gd2, 'rgba(255,255,255,0.4)');
      ctx.restore();
      txt(ctx, selN > 0 ? ('还贡 (' + selN + ')') : '还贡', bxx + bww / 2, byy + bhh / 2 + 1, 14.5,
        selN > 0 ? '#3b2a08' : '#2b3850', 'center', 700);
      hits.push({ x: bxx, y: byy, w: bww, h: bhh, act: 'confirmReturn' });
    }

    // 最近一条公示：谁被抽走了什么，所有人都能看到
    var lastLog = (T.log || []).slice(-1)[0];
    if (lastLog) {
      txt(ctx, lastLog.text, state.W / 2, barY - 15, 12.5,
        lastLog.kind === 'warn' ? '#f3b7b2' : C.dim, 'center');
    }

    // 摊牌：被抽者整手牌背面朝上摊开（独食三家同时摊三排），点任意一张抽走
    if (T.stage === 'pull' && T.pull && T.pull.rows) {
      var rows = T.pull.rows;
      var nMax = 1;
      rows.forEach(function (r) { if (r.n > nMax) nMax = r.n; });
      var gp2 = 6;
      var maxPw = rows.length >= 3 ? 38 : (rows.length === 2 ? 42 : 46);
      var fitPw = Math.floor((Math.min(state.W - 120, 680) - (nMax - 1) * gp2) / nMax);
      var pw = Math.max(16, Math.min(maxPw, fitPw));
      var phh = Math.round(pw * 1.4);
      var rowGap = rows.length >= 3 ? 12 : 22;
      var blockH = rows.length * phh + (rows.length - 1) * rowGap;
      var top = L.center.y - blockH / 2 - 2;
      // 横屏：牌桌带矮，摊牌行整体上提，保证「已抽 X/Y」不压底部状态条
      if (L.landscape) top = Math.min(top, barY - blockH - 26);
      top = Math.max(top, L.table.top + 8);

      // 配额进度/置灰仅用于独食抽牌方向（winners.length===1，多败方行，got 按每家计）；
      // 被抽方向只有一排且 drawnFrom 是跨胜方合计，cap 无意义，保持"N 张"不置灰；
      // 2v2 的 cap 为 null（无上限），同样保持现状
      var loneDraw = !!(T.plan && T.plan.winners && T.plan.winners.length === 1);
      rows.forEach(function (row, ri) {
        var n = Math.max(1, row.n);
        var totalW = n * pw + (n - 1) * gp2;
        var sx = Math.max(104, (state.W - totalW) / 2);
        var sy = top + ri * (phh + rowGap);
        var capped = loneDraw && row.cap != null;
        var gotN = row.got || 0;
        var full = capped && gotN >= row.cap;

        box(ctx, sx - 92, sy - 4, 80, phh + 8, 9, 'rgba(10,20,34,0.62)', 'rgba(216,179,106,0.28)');
        txt(ctx, SEAT_NAMES[row.rel], sx - 52, sy + phh / 2 - 5, 13, C.gold, 'center', 600);
        txt(ctx, capped ? (full ? '已满' : ('剩 ' + (row.cap - gotN) + '/' + row.cap)) : (row.n + ' 张'),
          sx - 52, sy + phh / 2 + 11, 11.5, full ? '#d99a98' : C.dim, 'center');

        ctx.save();
        if (full) ctx.globalAlpha = 0.35;
        for (var i = 0; i < n; i++) {
          var cx2 = sx + i * (pw + gp2);
          drawBack(ctx, cx2, sy, pw, phh);
          if (!full) hits.push({ x: cx2 - 2, y: sy - 4, w: pw + 4, h: phh + 8, act: 'pullCard', p: row.rel, idx: i });
        }
        ctx.restore();
      });

      var doneTxt = '已抽 ' + (T.pull.done || 0) + ' / ' + (T.pull.total || 0) + ' 张';
      txt(ctx, doneTxt, state.W / 2, top + blockH + 18, 12.5, C.dim, 'center');
    }
  }

  function settle(ctx, S, L, hits) {
    var res = S.lastResult;
    if (!res) return;
    var H = L.H;
    var e = easeOut(fxProgress(S, 'settleT0', 300));
    ctx.save();
    if (e < 1) {
      ctx.globalAlpha = e;
      ctx.translate(0, 22 * (1 - e));
    }
    overlay(ctx, H, state.W, H);

    var pw = 660, ph = 520;
    var px = (state.W - pw) / 2, py = (H - ph) / 2 - 40;
    box(ctx, px, py, pw, ph, 16, C.panel, C.panelLine);

    var title = res.camp.mode === 'lone' ? '本局：独食 1 打 3' : '本局：2 打 2';
    txt(ctx, title, state.W / 2, py + 52, 26, C.gold, 'center', 600);
    var sub = res.camp.mode === 'lone'
      ? '独食者 ' + SEAT_NAMES[res.camp.lone] + ' 拿第 ' + (res.ranks.indexOf(res.camp.lone) + 1) + ' 名'
      : '胜方名次 ' + res.winRanks.join('、');
    txt(ctx, sub, state.W / 2, py + 84, 15, C.dim);
    // 连胜 / 本局得失提示
    var myScore = res.scores[0] || 0;
    var streak = (S.stats && S.stats.streak) || 0;
    var line = (myScore > 0 ? '本局 +' + myScore + ' 分' : myScore < 0 ? '本局 ' + myScore + ' 分' : '本局 0 分');
    if (streak >= 2 && myScore > 0) line += ' · 已连胜 ' + streak + ' 局';
    else if (myScore > 0) line += ' · 开张了';
    txt(ctx, line, state.W / 2, py + 110, 15, myScore > 0 ? C.gold : C.dim);

    // 连胜光效：连胜 ≥3 时标题两侧描一圈暖光
    if (streak >= 3 && myScore > 0) {
      ctx.save();
      var pul = 0.45 + 0.25 * Math.sin(Date.now() / 320);
      ctx.globalAlpha = pul;
      ctx.strokeStyle = '#ffd27a';
      ctx.lineWidth = 3;
      rr(ctx, px - 6, py - 6, pw + 12, ph + 12, 20);
      ctx.stroke();
      ctx.restore();
    }

    var cols = [px + 40, px + 200, px + 330, px + 470, px + 590];
    var hy = py + 142;
    ['名次', '玩家', '阵营', '本局', '累计'].forEach(function (label, i) {
      txt(ctx, label, cols[i], hy, 15, C.dim, i === 0 ? 'left' : 'center');
    });

    res.ranks.forEach(function (p, i) {
      var y = hy + 44 + i * 46;
      var team = res.camp.mode === 'lone'
        ? (p === res.camp.lone ? '独食' : '三人队')
        : (res.camp.teamA.indexOf(p) >= 0 ? '♠3/♠A' : '对方队');
      var mine = S.scores[p] !== undefined ? S.scores[p] : 0;
      txt(ctx, '第 ' + (i + 1), cols[0], y, 17, C.text, 'left');
      txt(ctx, SEAT_NAMES[p], cols[1], y, 17, C.text);
      txt(ctx, team, cols[2], y, 15, C.dim);
      var s = res.scores[p];
      txt(ctx, (s > 0 ? '+' : '') + s, cols[3], y, 17, s > 0 ? C.gold : s < 0 ? '#d99a98' : C.dim);
      txt(ctx, (mine > 0 ? '+' : '') + mine, cols[4], y, 17, mine > 0 ? C.gold : mine < 0 ? '#d99a98' : C.dim);
      ctx.strokeStyle = 'rgba(216,179,106,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + 32, y + 24);
      ctx.lineTo(px + pw - 32, y + 24);
      ctx.stroke();
    });

    var isLast = S.round >= S.rounds;
    var bw = 200, bh = 58;
    box(ctx, state.W / 2 - bw / 2, py + ph - 92, bw, bh, 10, C.gold, null);
    txt(ctx, isLast ? '看总成绩' : '下一局', state.W / 2, py + ph - 63, 21, '#101f33', 'center', 600);
    hits.push({ x: state.W / 2 - bw / 2, y: py + ph - 92, w: bw, h: bh, act: 'next' });

    // 分享战绩 / 复盘（并排两个次级按钮）
    box(ctx, px + 40, py + ph - 84, 120, 44, 10, C.btn, C.panelLine);
    txt(ctx, '分享战绩', px + 100, py + ph - 62, 15, C.text, 'center', 600);
    hits.push({ x: px + 40, y: py + ph - 84, w: 120, h: 44, act: 'share' });

    box(ctx, px + pw - 160, py + ph - 84, 120, 44, 10, C.btn, C.panelLine);
    txt(ctx, '复盘', px + pw - 100, py + ph - 62, 15, C.text, 'center', 600);
    hits.push({ x: px + pw - 160, y: py + ph - 84, w: 120, h: 44, act: 'replay' });
    ctx.restore();
  }

  // ---------- 全场总结 ----------
  // ---------- 开始界面 ----------
  function menu(ctx, S, L, hits) {
    var H = L.H;
    var land = L.landscape;

    // 横屏按 750 高设计，主内容宽度用屏宽的 55%，避免超大屏上字太小
    var cw = land ? Math.max(700, Math.min(1040, state.W * 0.6)) : Math.min(640, state.W - 56);
    var cx = (state.W - cw) / 2;

    // 主菜单内容整体居中：竖屏高屏不再把按钮顶在上半屏、下面留一大片空
    var lines = [
      '♦4 起手，第一手必须带 ♦4',
      '点数 3 最大、4 最小；花色 ♠ > ♥ > ♣ > ♦',
      '对子比「一对里较大那张」的花色',
      '♠3 / ♠A 打出时在座位旁亮牌，两张都亮＝独食 1 打 3',
      '第 2 局起进贡：胜方从败方抽牌，抽到身份牌亮出归还重抽'
    ];
    var lh = land ? 36 : 28;
    var rh = lh * lines.length + (land ? 52 : 54);
    var gapBefore = land ? 30 : 34;
    var bh = land ? 96 : 88;
    var contentH = 46 + 84 + rh + gapBefore + bh;
    // 横屏牌桌内框顶边约 198：标题落在边框上方，玩法卡与按钮落进桌内
    var ty = land ? 124 : Math.max(100, Math.round((H - contentH) / 2 + 46));

    txt(ctx, '十三张 · 独食', state.W / 2, ty, land ? 64 : 46, C.gold, 'center', 700);
    txt(ctx, '横县找朋友 · ♠3 与 ♠A 同持即独食', state.W / 2, ty + (land ? 54 : 48), land ? 22 : 16, C.dim);

    var ry = ty + (land ? 86 : 84);
    box(ctx, cx, ry, cw, rh, 14, 'rgba(10,20,34,0.74)', C.panelLine);
    txt(ctx, '玩法', cx + (land ? 32 : 24), ry + (land ? 26 : 26), land ? 19 : 15, C.gold, 'left', 600);
    lines.forEach(function (l, i) {
      txt(ctx, '· ' + l, cx + (land ? 32 : 24),
        ry + (land ? 58 : 56) + i * lh, land ? 23 : 14, C.text, 'left');
    });

    // 单机入口已取消：开始游戏直接进联机大厅，好友房和快速人机都在服务端房间里进行。
    var by = ry + rh + gapBefore;
    var bw = land ? Math.min(cw * 0.62, 700) : Math.min(cw, 460);
    var bx = (state.W - bw) / 2;
    box(ctx, bx, by, bw, bh, 14, C.gold, null);
    txt(ctx, '开始游戏', state.W / 2, by + bh * 0.40 + 1, land ? 34 : 28, '#101f33', 'center', 700);
    txt(ctx, '联机房间 · 好友或机器人', state.W / 2, by + bh * 0.72,
      land ? 17 : 13.5, 'rgba(16,31,51,0.72)', 'center', 500);
    hits.push({ x: bx, y: by, w: bw, h: bh, act: 'netOpen' });

    txt(ctx, '第 1 局不进贡 · 出牌逆时针 · 纯积分休闲娱乐，不涉及任何财物', state.W / 2, H - 18, land ? 17 : 13, C.dim);
  }

  function summary(ctx, S, L, hits) {
    var H = L.H;
    overlay(ctx, H, state.W, H);
    var pw = 600, ph = 460;
    var px = (state.W - pw) / 2, py = (H - ph) / 2;
    box(ctx, px, py, pw, ph, 16, C.panel, C.panelLine);

    txt(ctx, '全场结束 · ' + S.rounds + ' 局', state.W / 2, py + 56, 26, C.gold, 'center', 600);
    S.scores.forEach(function (s, i) {
      var y = py + 120 + i * 46;
      txt(ctx, SEAT_NAMES[i], px + 90, y, 19, C.text, 'left');
      txt(ctx, (s > 0 ? '+' : '') + s, px + pw - 90, y, 19, s > 0 ? C.gold : s < 0 ? '#d99a98' : C.dim, 'right');
    });
    var bw = 260, bh = 58;
    box(ctx, state.W / 2 - bw / 2, py + ph - 88, bw, bh, 10, C.gold, null);
    txt(ctx, '再来一场', state.W / 2, py + ph - 59, 20, '#101f33', 'center', 600);
    hits.push({ x: state.W / 2 - bw / 2, y: py + ph - 88, w: bw, h: bh, act: 'newMatch' });

    box(ctx, state.W / 2 - bw / 2, py + ph - 22, bw, 42, 10, C.btn, C.panelLine);
    txt(ctx, '回到开始界面', state.W / 2, py + ph - 1, 16, C.text, 'center');
    hits.push({ x: state.W / 2 - bw / 2, y: py + ph - 22, w: bw, h: 42, act: 'toMenu' });
  }

  // ---------- 测试模式小面板（页头「测试」入口） ----------
  function testPanel(ctx, S, L, hits) {
    overlay(ctx, L.H, state.W, L.H);
    var pw = 520, ph = 296;
    var px = (state.W - pw) / 2, py = (L.H - ph) / 2;
    if (py < 8) py = 8;
    if (px < 8) px = (state.W - pw) / 2;
    box(ctx, px, py, pw, ph, 16, C.panel, C.panelLine);
    txt(ctx, '测试模式', state.W / 2, py + 34, 20, C.gold, 'center', 600);
    txt(ctx, '主视角固定 4×3 / 4×A / 4×2 + ♦4', state.W / 2, py + 60, 14, C.dim, 'center');

    var bw = pw - 56, bh = 52;
    var bx = state.W / 2 - bw / 2, by = py + 84;
    box(ctx, bx, by, bw, bh, 10, C.gold, null);
    txt(ctx, '特殊牌开局（4×3 / 4×A / 4×2 + ♦4）', state.W / 2, by + bh / 2, 17, '#101f33', 'center', 600);
    hits.push({ x: bx, y: by, w: bw, h: bh, act: 'testHand' });

    by += bh + 12;
    box(ctx, bx, by, bw, bh, 10, C.btn, C.panelLine);
    txt(ctx, '进贡流程演示', state.W / 2, by + bh / 2, 17, C.text, 'center');
    hits.push({ x: bx, y: by, w: bw, h: bh, act: 'testTribute' });

    by += bh + 12;
    box(ctx, bx, by, bw, 44, 10, C.btn, C.panelLine);
    txt(ctx, '关闭', state.W / 2, by + 22, 16, C.text, 'center');
    hits.push({ x: bx, y: by, w: bw, h: 44, act: 'testMenu' });
  }

  function toast(ctx, S, L) {
    var w = 420, h = 54;
    // 横屏牌桌带太矮，提示条放到手牌上方（不压出牌区）
    var y0 = L.seats.south.y - 66;
    box(ctx, state.W / 2 - w / 2, y0, w, h, 10, 'rgba(10,20,34,0.9)', C.panelLine);
    txt(ctx, S.toast, state.W / 2, y0 + 27, 17, C.text);
  }

  // ---------- 联机：大厅 / 房号键盘 / 房间等待 ----------
  function lobbyPanel(ctx, S, L, hits) {
    var H = L.H;
    overlay(ctx, H, state.W, H);
    var pw = 660;
    var ph = S.lobby.kind === 'keypad' ? 660 : S.lobby.kind === 'config' ? 340 :
      S.lobby.kind === 'quick' ? 430 : 560;
    var px = (state.W - pw) / 2, py = (H - ph) / 2 - ((state.W / H) >= 1.2 ? 20 : 0);
    if (py < 8) py = 8;
    box(ctx, px, py, pw, ph, 16, C.panel, C.panelLine);

    if (S.lobby.kind === 'entry') {
      txt(ctx, '选择牌桌', state.W / 2, py + 44, 27, C.gold, 'center', 600);
      txt(ctx, '好友联机 / 快速人机 · 都在联机房间里进行', state.W / 2, py + 75, 14, C.dim);
      var srv = String(S.lobby.url || '');
      var srvW = Math.min(pw - 80, Math.max(240, (srv.length + 3) * 7.4));
      var srvX = (state.W - srvW) / 2;
      box(ctx, srvX, py + 92, srvW, 32, 16, C.btn, C.panelLine);
      txt(ctx, '服务器 ' + srv, state.W / 2, py + 113, 12.5, C.gold, 'center');
      hits.push({ x: srvX, y: py + 92, w: srvW, h: 32, act: 'netServer' });

      var by = py + 148;
      box(ctx, px + 40, by, pw - 80, 86, 12, C.gold, null);
      txt(ctx, '快速开局', state.W / 2, by + 33, 25, '#101f33', 'center', 600);
      txt(ctx, '1 真人 + 3 机器人 · 8 局', state.W / 2, by + 64, 14, 'rgba(16,31,51,0.72)', 'center', 500);
      hits.push({ x: px + 40, y: by, w: pw - 80, h: 86, act: 'netQuick' });

      by += 98;
      box(ctx, px + 40, by, pw - 80, 64, 12, C.btn, C.panelLine);
      txt(ctx, '创建好友房', state.W / 2, by + 24, 20, C.text, 'center', 600);
      txt(ctx, '设局数 / 进贡 / 限时，拿 4 位房号', state.W / 2, by + 46, 12.5, C.dim, 'center');
      hits.push({ x: px + 40, y: by, w: pw - 80, h: 64, act: 'netConfig' });

      by += 74;
      box(ctx, px + 40, by, pw - 80, 64, 12, C.btn, C.panelLine);
      txt(ctx, '加入房间', state.W / 2, by + 24, 20, C.text, 'center', 600);
      txt(ctx, '输入朋友发来的 4 位房号', state.W / 2, by + 46, 12.5, C.dim, 'center');
      hits.push({ x: px + 40, y: by, w: pw - 80, h: 64, act: 'netKeypad' });

      txt(ctx, S.lobby.err || S.netStatus || '', state.W / 2, by + 92, 14,
        S.lobby.err ? '#e8b0ae' : C.dim);

      box(ctx, px + 150, py + ph - 80, pw - 300, 52, 10, C.btn, C.panelLine);
      txt(ctx, '返回主界面', state.W / 2, py + ph - 54, 17, C.text, 'center');
      hits.push({ x: px + 150, y: py + ph - 80, w: pw - 300, h: 52, act: 'netBack' });
      return;
    }

    if (S.lobby.kind === 'quick') {
      txt(ctx, '快速开局', state.W / 2, py + 46, 27, C.gold, 'center', 600);
      txt(ctx, '1 真人 + 3 机器人 · 8 局 · 重贡', state.W / 2, py + 81, 14, C.dim);

      var qsrvW = Math.min(pw - 90, Math.max(230, (String(S.lobby.url || '').length + 3) * 7.2));
      box(ctx, (state.W - qsrvW) / 2, py + 108, qsrvW, 30, 15, C.btn, C.panelLine);
      txt(ctx, '服务器 ' + String(S.lobby.url || ''), state.W / 2, py + 128, 12.5, C.gold, 'center');
      hits.push({ x: (state.W - qsrvW) / 2, y: py + 108, w: qsrvW, h: 30, act: 'netServer' });

      var qerr = S.lobby.err || '';
      txt(ctx, qerr || '正在创建房间并补入机器人…', state.W / 2, py + 188, 15,
        qerr ? '#e8b0ae' : C.text, 'center', qerr ? 500 : 400);
      if (!qerr) {
        txt(ctx, '开局后直接发牌；掉线可重连，座位会被机器人托管', state.W / 2, py + 214, 12.5, C.dim);
      }

      if (qerr) {
        box(ctx, px + 40, py + 250, pw - 80, 58, 12, C.gold, null);
        txt(ctx, '重新准备', state.W / 2, py + 279, 20, '#101f33', 'center', 600);
        hits.push({ x: px + 40, y: py + 250, w: pw - 80, h: 58, act: 'netQuickRetry' });
      } else {
        txt(ctx, '●   ●   ●', state.W / 2, py + 272, 20, C.gold, 'center', 600);
        txt(ctx, '请稍候', state.W / 2, py + 297, 12.5, C.dim, 'center');
      }

      box(ctx, px + 150, py + 330, pw - 300, 50, 10, C.btn, C.panelLine);
      txt(ctx, '取消并返回主界面', state.W / 2, py + 355, 16, C.text, 'center');
      hits.push({ x: px + 150, y: py + 330, w: pw - 300, h: 50, act: 'netQuickCancel' });
      return;
    }

    if (S.lobby.kind === 'config') {
      var RC = S.roomCfg || {};
      txt(ctx, '创建房间 · 房间设置', state.W / 2, py + 34, 22, C.gold, 'center', 600);

      function chipRow(rowY, label, opts) {
        txt(ctx, label, px + 44, rowY + 10, 15, C.dim, 'left');
        var tot = (opts.length - 1) * 8;
        opts.forEach(function (o) { tot += o.w; });
        var cx0 = px + pw - 40 - tot;
        opts.forEach(function (o) {
          box(ctx, cx0, rowY - 8, o.w, 34, 8, o.on ? C.gold : C.btn, o.on ? null : C.panelLine);
          txt(ctx, o.label, cx0 + o.w / 2, rowY + 9, 13, o.on ? '#101f33' : C.text, 'center', o.on ? 600 : 400);
          hits.push({ x: cx0, y: rowY - 8, w: o.w, h: 34, act: 'cfgSet', key: o.key, v: o.v });
          cx0 += o.w + 8;
        });
      }

      chipRow(py + 78, '局数', [8, 12, 16, 24, 32].map(function (n) {
        return { w: 56, label: String(n), key: 'rounds', v: n, on: S.rounds === n };
      }));
      chipRow(py + 126, '进贡', [
        { w: 100, label: '重贡 4/2', key: 'tribute', v: 'heavy', on: RC.tributeTier === 'heavy' },
        { w: 100, label: '轻贡 2/1', key: 'tribute', v: 'light', on: RC.tributeTier === 'light' },
        { w: 84, label: '关闭', key: 'tribute', v: 'off', on: RC.tributeTier === 'off' }
      ]);
      chipRow(py + 174, '每步限时', [
        { w: 84, label: '15 秒', key: 'seconds', v: 15, on: RC.turnSeconds === 15 },
        { w: 84, label: '20 秒', key: 'seconds', v: 20, on: RC.turnSeconds === 20 },
        { w: 84, label: '30 秒', key: 'seconds', v: 30, on: RC.turnSeconds === 30 }
      ]);
      chipRow(py + 222, '队友提示', [
        { w: 84, label: '关闭', key: 'hint', v: 'none', on: RC.teamHint === 'none' },
        { w: 84, label: '出牌后', key: 'hint', v: 'reveal', on: RC.teamHint === 'reveal' },
        { w: 84, label: '常显', key: 'hint', v: 'always', on: RC.teamHint === 'always' }
      ]);

      if (S.lobby.err) txt(ctx, S.lobby.err, state.W / 2, py + 258, 12, '#e8b0ae', 'center');
      else txt(ctx, '局数与规则由房主设定 · 纯积分娱乐，无充值无兑换', state.W / 2, py + 258, 12, C.dim, 'center');

      var cy2 = py + ph - 58;
      box(ctx, px + 40, cy2, 200, 42, 10, C.gold, null);
      txt(ctx, '创建', px + 140, cy2 + 21, 17, '#101f33', 'center', 600);
      hits.push({ x: px + 40, y: cy2, w: 200, h: 42, act: 'netCfgConfirm' });
      box(ctx, px + 258, cy2, 140, 42, 10, C.btn, C.panelLine);
      txt(ctx, '返回', px + 328, cy2 + 21, 16, C.text, 'center');
      hits.push({ x: px + 258, y: cy2, w: 140, h: 42, act: 'netCancel' });

      // 测试开关：开局直接进贡，方便检验抽牌流程
      var tOn = !!RC.testTribute;
      box(ctx, px + 410, cy2, 206, 42, 10, tOn ? C.gold : C.btn, tOn ? null : C.panelLine);
      txt(ctx, (tOn ? '● ' : '○ ') + '开局即进贡', px + 513, cy2 + 21, 12.5,
        tOn ? '#101f33' : C.text, 'center', tOn ? 600 : 400);
      hits.push({ x: px + 410, y: cy2, w: 206, h: 42, act: 'cfgSet', key: 'testTribute', v: !tOn });
      return;
    }

    // 房号键盘
    txt(ctx, '输入房间号', state.W / 2, py + 44, 24, C.gold, 'center', 600);
    var code = S.lobby.code || '';
    var digits = (code + '____').slice(0, 4).split('');
    var cw = 64, gapd = 14;
    var totalW = 4 * cw + 3 * gapd;
    var cx0 = state.W / 2 - totalW / 2;
    digits.forEach(function (d, i) {
      var x = cx0 + i * (cw + gapd);
      box(ctx, x, py + 70, cw, 68, 10, 'rgba(10,20,34,0.7)', 'rgba(216,179,106,0.3)');
      txt(ctx, d === '_' ? '' : d, x + cw / 2, py + 104, 26, C.text);
    });

    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '退', '0', '进'];
    var kw = 148, kh = 66, kgx = 20, kgy = 10;
    var kx0 = state.W / 2 - (3 * kw + 2 * kgx) / 2;
    keys.forEach(function (k, i) {
      var cx = kx0 + (i % 3) * (kw + kgx);
      var cy = py + 154 + Math.floor(i / 3) * (kh + kgy);
      var primary = k === '进';
      box(ctx, cx, cy, kw, kh, 10, primary ? C.gold : C.btn, primary ? null : C.panelLine);
      txt(ctx, k, cx + kw / 2, cy + kh / 2, 24, primary ? '#101f33' : C.text, 'center', 600);
      if (k === '退') hits.push({ x: cx, y: cy, w: kw, h: kh, act: 'netBackspace' });
      else if (k === '进') hits.push({ x: cx, y: cy, w: kw, h: kh, act: 'netJoin' });
      else hits.push({ x: cx, y: cy, w: kw, h: kh, act: 'netDigit', d: k });
    });

    box(ctx, kx0, py + ph - 62, 3 * kw + 2 * kgx, 46, 10, C.btn, C.panelLine);
    txt(ctx, '取消', state.W / 2, py + ph - 39, 17, C.text, 'center');
    hits.push({ x: kx0, y: py + ph - 62, w: 3 * kw + 2 * kgx, h: 46, act: 'netCancel' });
  }

  function roomPanel(ctx, S, L, hits) {
    var H = L.H;
    overlay(ctx, H, state.W, H);
    var pw = 660, ph = 660;
    var px = (state.W - pw) / 2, py = (H - ph) / 2;
    box(ctx, px, py, pw, ph, 16, C.panel, C.panelLine);

    txt(ctx, '房间号', state.W / 2, py + 46, 16, C.dim, 'center');
    txt(ctx, String(S.room || ''), state.W / 2, py + 96, 44, C.gold, 'center', 600);
    txt(ctx, '把房号发给朋友，或用链接 ?room=房号 进入', state.W / 2, py + 132, 14, C.dim);

    var RC2 = S.roomCfg || {};
    var tierTxt = { heavy: '重贡 4/2', light: '轻贡 2/1', off: '不进贡' };
    var hintTxt = { none: '不提示', reveal: '出牌后提示', always: '常显' };
    txt(ctx, (S.rounds || 8) + ' 局 · ' + (tierTxt[RC2.tributeTier] || '重贡') +
      ' · 每步 ' + (RC2.turnSeconds || 20) + ' 秒 · 队友' + (hintTxt[RC2.teamHint] || '不提示'),
      state.W / 2, py + 154, 13, C.gold, 'center');

    (S.seats || []).forEach(function (s, i) {
      var y = py + 178 + i * 56;
      box(ctx, px + 40, y, pw - 80, 54, 10, 'rgba(10,20,34,0.6)',
        s.isYou ? C.gold : 'rgba(216,179,106,0.18)');
      txt(ctx, (s.isYou ? '你 · ' : '') + s.name, px + 62, y + 32, 18, C.text, 'left');
      var right = s.ai ? '机器人' : s.online ? (s.ready ? '已准备' : '未准备') : '空位';
      txt(ctx, right, px + pw - 62, y + 32, 15,
        s.ready || s.ai ? C.gold : C.dim, 'right');
    });

    var bw = 260, bh = 62;
    // 昵称 / 发言：头像行下方一排放两个胶囊，朋友圈式操作，不挤占席位列表
    var nick = S.myName || '玩家';
    var chipW = 200, chipH = 44, chipY = py + 412;
    var cx0 = state.W / 2 - chipW - 10;
    box(ctx, cx0, chipY, chipW, chipH, 22, C.btn, C.panelLine);
    txt(ctx, '改名 · ' + nick, cx0 + chipW / 2, chipY + chipH / 2, 15, C.text, 'center');
    hits.push({ x: cx0, y: chipY, w: chipW, h: chipH, act: 'netRename' });
    var cx1 = state.W / 2 + 10;
    box(ctx, cx1, chipY, chipW, chipH, 22, C.btn, C.panelLine);
    txt(ctx, '发言', cx1 + chipW / 2, chipY + chipH / 2, 15, C.text, 'center');
    hits.push({ x: cx1, y: chipY, w: chipW, h: chipH, act: 'chatOpen' });

    var y2 = py + ph - 168;
    if (S.isHost) {
      box(ctx, state.W / 2 - bw / 2, y2, bw, bh, 10, C.gold, null);
      txt(ctx, '开始（空位补机器人）', state.W / 2, y2 + 33, 18, '#101f33', 'center', 600);
      hits.push({ x: state.W / 2 - bw / 2, y: y2, w: bw, h: bh, act: 'netStart' });
    } else {
      box(ctx, state.W / 2 - bw / 2, y2, bw, bh, 10, C.btn, C.panelLine);
      txt(ctx, S.myReady ? '取消准备' : '准备', state.W / 2, y2 + 33, 19, C.text, 'center', 600);
      hits.push({ x: state.W / 2 - bw / 2, y: y2, w: bw, h: bh, act: 'netReady' });
    }

    if (S.isHost) {
      var lw = 220, lg = 14;
      box(ctx, state.W / 2 - lw - lg / 2, y2 + 78, lw, 52, 10, 'rgba(140,47,42,0.9)', 'rgba(255,210,180,0.5)');
      txt(ctx, '解散房间', state.W / 2 - lg / 2 - lw / 2, y2 + 78 + 27, 16, '#ffe9dd', 'center', 600);
      hits.push({ x: state.W / 2 - lw - lg / 2, y: y2 + 78, w: lw, h: 52, act: 'dissolveWait' });
      box(ctx, state.W / 2 + lg / 2, y2 + 78, lw, 52, 10, C.btn, C.panelLine);
      txt(ctx, '离开房间', state.W / 2 + lg / 2 + lw / 2, y2 + 78 + 27, 16, C.text, 'center');
      hits.push({ x: state.W / 2 + lg / 2, y: y2 + 78, w: lw, h: 52, act: 'netLeave' });
    } else {
      box(ctx, state.W / 2 - 110, y2 + 78, 220, 52, 10, C.btn, C.panelLine);
      txt(ctx, '离开房间', state.W / 2, y2 + 78 + 27, 17, C.text, 'center');
      hits.push({ x: state.W / 2 - 110, y: y2 + 78, w: 220, h: 52, act: 'netLeave' });
    }
  }

  // ---------- 联机：发言面板 / 气泡 ----------
  function chatName(S, rel) {
    var s = (S.seats || [])[rel];
    var nm = s && s.name ? s.name : (SEAT_NAMES[rel] || '');
    return rel === 0 ? '你' : nm;
  }

  function chatPanel(ctx, S, L, hits) {
    if (!S.chatOpen) return;
    // 常驻右侧的轻量发言浮层：不铺全屏、不压手牌/操作条，打开时仍可继续出牌
    var pw = Math.min(320, state.W - 32);
    var ph = 300;
    var px = state.W - 16 - pw;
    var py = Math.max(L.table.top + 8, L.actions.y - 12 - ph);
    var panelH = Math.min(ph, L.actions.y - 12 - py);
    if (S.chatT0) {
      var q = Math.min(1, (Date.now() - S.chatT0) / 190);
      px += Math.round((1 - (1 - Math.pow(1 - q, 3))) * (pw + 20));
    }
    box(ctx, px, py, pw, panelH, 14, C.panel, C.panelLine);
    hits.push({ x: px, y: py, w: pw, h: panelH, act: 'chatPanel' });

    txt(ctx, '发言', px + 14, py + 21, 18, C.gold, 'left', 600);
    var closeW = 34, closeH = 30;
    box(ctx, px + pw - closeW - 8, py + 7, closeW, closeH, 8, 'rgba(216,179,106,0.12)', C.panelLine);
    txt(ctx, '×', px + pw - closeW / 2 - 8, py + 7 + closeH / 2, 18, C.dim, 'center');
    hits.push({ x: px + pw - closeW - 8, y: py + 7, w: closeW, h: closeH, act: 'chatClose' });

    // 最近两条：自己的发言用金色，别人的保持正文色；面板窄时裁掉溢出
    var msgs = (S.chats || []).slice(-2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(px + 14, py + 36, pw - 28, 32);
    ctx.clip();
    if (!msgs.length) {
      txt(ctx, '还没人说话', px + 14, py + 48, 12, C.dim, 'left');
    } else {
      msgs.forEach(function (c, i) {
        var line = chatName(S, c.rel) + (c.kind === 'emoji' ? ' ' : '：') + c.text;
        txt(ctx, line, px + 14, py + 42 + i * 15, 11, c.rel === 0 ? C.gold : C.text, 'left');
      });
    }
    ctx.restore();

    // 表情 / 短语页签：小面板只展示一页，避免把 16 个表情全摊开压住牌桌
    var tabW = Math.round((pw - 28 - 8) / 2), tabH = 26, tabY = py + 70;
    box(ctx, px + 14, tabY, tabW, tabH, 8,
      (S.chatTab || 'emoji') === 'emoji' ? 'rgba(216,179,106,0.18)' : C.btn,
      (S.chatTab || 'emoji') === 'emoji' ? C.gold : C.panelLine);
    txt(ctx, '表情', px + 14 + tabW / 2, tabY + tabH / 2, 12,
      (S.chatTab || 'emoji') === 'emoji' ? C.gold : C.text, 'center', 600);
    hits.push({ x: px + 14, y: tabY, w: tabW, h: tabH, act: 'chatTabEmoji' });

    box(ctx, px + 14 + tabW + 8, tabY, tabW, tabH, 8,
      (S.chatTab || 'emoji') === 'phrase' ? 'rgba(216,179,106,0.18)' : C.btn,
      (S.chatTab || 'emoji') === 'phrase' ? C.gold : C.panelLine);
    txt(ctx, '短语', px + 14 + tabW + 8 + tabW / 2, tabY + tabH / 2, 12,
      (S.chatTab || 'emoji') === 'phrase' ? C.gold : C.text, 'center', 600);
    hits.push({ x: px + 14 + tabW + 8, y: tabY, w: tabW, h: tabH, act: 'chatTabPhrase' });

    var gridY = py + 102;
    if ((S.chatTab || 'emoji') === 'emoji') {
      var ec = (S.chatEmoji || []).slice(0, 16);
      var cols = 4, cellW = (pw - 28 - 18) / 4, cellH = 30, gap = 6;
      ec.forEach(function (e, i) {
        var c = i % cols, r = Math.floor(i / cols);
        var x = px + 14 + c * (cellW + gap), y = gridY + r * (cellH + gap);
        box(ctx, x, y, cellW, cellH, 8, C.btn, C.panelLine);
        txt(ctx, e, x + cellW / 2, y + cellH / 2, 19, C.text, 'center');
        hits.push({ x: x, y: y, w: cellW, h: cellH, act: 'chatEmoji', text: e });
      });
    } else {
      var phs = (S.chatPhrases || []).slice(0, 8);
      var cols2 = 2, cellW2 = (pw - 28 - 6) / 2, cellH2 = 30, gap2 = 6;
      phs.forEach(function (p, i) {
        var c = i % cols2, r = Math.floor(i / cols2);
        var x = px + 14 + c * (cellW2 + gap2), y = gridY + r * (cellH2 + gap2);
        box(ctx, x, y, cellW2, cellH2, 8, C.btn, C.panelLine);
        txt(ctx, p, x + cellW2 / 2, y + cellH2 / 2, 13, C.text, 'center');
        hits.push({ x: x, y: y, w: cellW2, h: cellH2, act: 'chatText', text: p });
      });
    }

    // 打字入口固定在小面板底部
    var typeY = py + panelH - 38, typeH = 30;
    box(ctx, px + 14, typeY, pw - 28, typeH, 8, C.btn, C.panelLine);
    txt(ctx, '✎ 打字发言（≤16 字）', px + pw / 2, typeY + typeH / 2, 12, C.text, 'center', 600);
    hits.push({ x: px + 14, y: typeY, w: pw - 28, h: typeH, act: 'chatType' });
  }

  // 牌桌上冒出的最近发言（8 秒内、最多 3 条），从手牌左侧向上堆
  function chatBubbles(ctx, S, L) {
    if (S.mode !== 'online' || S.chatOpen) return;
    var now = Date.now();
    var live = (S.chats || []).filter(function (c) { return now - (c.ts || 0) < 8000; }).slice(-3);
    if (!live.length) return;
    live.forEach(function (c, i) {
      var txtS = chatName(S, c.rel) + (c.kind === 'emoji' ? ' ' : '：') + c.text;
      ctx.save();
      ctx.font = '400 ' + (c.kind === 'emoji' ? 16 : 13) + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
      var tw = Math.min(300, Math.round(ctx.measureText(txtS).width) + 24);
      ctx.restore();
      // 从座位牌上沿往上叠，不压头像与操作条
      var x = L.seats.south.x, y = L.seats.south.y - 10 - (live.length - i) * 32;
      box(ctx, x, y, tw, 28, 14, 'rgba(10,20,34,0.92)', 'rgba(216,179,106,0.35)');
      txt(ctx, txtS, x + 12, y + 14, c.kind === 'emoji' ? 16 : 13, C.text, 'left');
    });
  }

  // ---------- 记牌器 ----------
  // 已知牌＝我的手牌＋桌上已出的牌；52 张减去这些即各点数剩余张数
  function remainByRank(S) {
    var left = {};
    for (var r = 2; r <= 14; r++) left[r] = 4;
    var g = S.game;
    if (!g) return left;
    var mine = (g.players && g.players[0] && g.players[0].hand) || [];
    mine.forEach(function (c) { if (c && left[c.r] !== undefined) left[c.r]--; });
    (g.trickPlays || []).forEach(function (pl) {
      (pl.cards || []).forEach(function (c) { if (c && left[c.r] !== undefined) left[c.r]--; });
    });
    // 进贡抽走的牌也算已知
    if (S.tribute && S.tribute.draws) {
      S.tribute.draws.forEach(function (d) {
        if (d && d.card && left[d.card.r] !== undefined) left[d.card.r]--;
      });
    }
    for (var k = 2; k <= 14; k++) if (left[k] < 0) left[k] = 0;
    return left;
  }

  function recordStrip(ctx, S, L) {
    if (!S.recordOpen) return;
    var order = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    var left = remainByRank(S);
    var cw = 46, ch = 42, gap = 2;
    var totalW = order.length * cw + (order.length - 1) * gap;
    var x0 = Math.round((state.W - totalW) / 2);
    var y = L.hand.y + L.hand.cardH + 6;
    if (y + ch > L.H - 2) y = L.H - ch - 2;
    ctx.save();
    ctx.globalAlpha = 0.96;
    box(ctx, x0 - 8, y - 4, totalW + 16, ch + 8, 10, 'rgba(10,20,34,0.86)', C.panelLine);
    order.forEach(function (r, i) {
      var x = x0 + i * (cw + gap);
      var n = left[r];
      var col = n === 0 ? 'rgba(180,190,205,0.35)' : n >= 2 ? C.text : C.gold;
      txt(ctx, rankText(r), x + cw / 2, y + 14, 15, n === 0 ? 'rgba(180,190,205,0.45)' : C.text, 'center', 600);
      txt(ctx, '余' + n, x + cw / 2, y + 32, 13, col, 'center');
    });
    ctx.restore();
  }

  // ---------- 工具抽屉 ----------
  function toolButton(ctx, x, y, w, h, label, sub, on, act, hits, tone) {
    box(ctx, x, y, w, h, 12, on ? 'rgba(216,179,106,0.2)' : C.btn, on ? C.gold : C.panelLine);
    txt(ctx, label, x + 16, y + h / 2 - (sub ? 10 : 0), 17, on ? C.gold : C.text, 'left', 600);
    if (sub) txt(ctx, sub, x + 16, y + h / 2 + 12, 13, C.dim, 'left');
    if (act) hits.push({ x: x, y: y, w: w, h: h, act: act });
  }

  function toolsDrawer(ctx, S, L, hits) {
    if (!S.toolsOpen) return;
    var pw = 620, ph = 540;
    var px = (state.W - pw) / 2, py = (L.H - ph) / 2 - 20;
    overlay(ctx, L.H, state.W, pw);
    box(ctx, px, py, pw, ph, 16, C.panel, C.panelLine);
    txt(ctx, '辅助工具', state.W / 2, py + 46, 22, C.gold, 'center', 600);
    var st = S.stats || {};
    txt(ctx, '战绩 ' + (st.wins || 0) + ' 胜 · 连胜 ' + (st.streak || 0),
      state.W / 2, py + 74, 14, C.dim, 'center');

    var cw = (pw - 48 - 16) / 2, ch = 74;
    var gx = px + 24, gy = py + 96;
    var items = [
      { label: '我的战绩', sub: '胜率 / 连胜 / 最近 5 局', act: 'stats', tone: 0 },
      { label: '复盘回放', sub: '上一局每一手出牌', act: 'replay', tone: 0 },
      { label: '新手引导', sub: '3 页图解规则', act: 'guide', tone: 0 },
      { label: '分享战绩', sub: '复制/发送战绩文案', act: 'share', tone: 1 },
      { label: '背景音乐', sub: (S.musicOn ? '已开启' : '已关闭'), act: 'music', on: !!S.musicOn, tone: 0 },
      { label: '震动反馈', sub: (S.vibOn ? '已开启' : '已关闭'), act: 'vib', on: !!S.vibOn, tone: 0 },
      { label: '牌背皮肤', sub: ['经典红', '青竹', '鎏金'][S.skin || 0], act: 'skin', tone: 0 },
      { label: '记牌器', sub: (S.recordOpen ? '已展开' : '已收起'), act: 'record', on: !!S.recordOpen, tone: 0 }
    ];
    items.forEach(function (it, i) {
      var c = i % 2, r = Math.floor(i / 2);
      toolButton(ctx, gx + c * (cw + 16), gy + r * (ch + 12), cw, ch,
        it.label, it.sub, !!it.on, it.act, hits, it.tone);
    });

    box(ctx, state.W / 2 - 110, py + ph - 62, 220, 46, 12, C.btn, C.panelLine);
    txt(ctx, '关闭', state.W / 2, py + ph - 39, 16, C.text, 'center', 600);
    hits.push({ x: state.W / 2 - 110, y: py + ph - 62, w: 220, h: 46, act: 'toolsClose' });
  }

  // ---------- 战绩 ----------
  function statsPanel(ctx, S, L, hits) {
    if (!S.statsOpen) return;
    var st = S.stats || {};
    var pw = 640, ph = 580;
    var px = (state.W - pw) / 2, py = (L.H - ph) / 2 - 30;
    overlay(ctx, L.H, state.W, pw);
    box(ctx, px, py, pw, ph, 16, C.panel, C.panelLine);
    txt(ctx, '我的战绩', state.W / 2, py + 48, 22, C.gold, 'center', 600);

    var cells = [
      { k: '场次', v: st.games || 0 },
      { k: '胜率', v: (st.games ? Math.round((st.wins || 0) / st.games * 100) : 0) + '%' },
      { k: '当前连胜', v: st.streak || 0 },
      { k: '最佳连胜', v: st.bestStreak || 0 }
    ];
    var cw = (pw - 48 - 36) / 4;
    cells.forEach(function (c, i) {
      var x = px + 24 + i * (cw + 12);
      box(ctx, x, py + 74, cw, 78, 12, 'rgba(20,34,54,0.9)', C.panelLine);
      txt(ctx, String(c.v), x + cw / 2, py + 108, 24, C.gold, 'center', 700);
      txt(ctx, c.k, x + cw / 2, py + 134, 13, C.dim, 'center');
    });
    txt(ctx, '最佳单局 ' + (st.best || 0) + ' 分 · 共 ' + (st.games || 0) + ' 局（' +
      (st.wins || 0) + ' 胜 ' + (st.losses || 0) + ' 负 ' + (st.draws || 0) + ' 平）',
      state.W / 2, py + 176, 14, C.dim, 'center');

    var cw2 = (pw - 48 - 16) / 2;
    var lx = px + 24, rx = px + 24 + cw2 + 16;
    txt(ctx, '最近 5 局', lx, py + 214, 16, C.gold, 'left', 600);
    txt(ctx, '本机排行榜（单局分）', rx, py + 214, 16, C.gold, 'left', 600);

    var hist = (st.history || []).slice(-5).reverse();
    if (!hist.length) txt(ctx, '还没有战绩', lx, py + 262, 14, C.dim, 'left');
    hist.forEach(function (h, i) {
      var y = py + 232 + i * 44;
      box(ctx, lx, y, cw2, 38, 10, 'rgba(20,34,54,0.72)', 'rgba(216,179,106,0.16)');
      var tag = h.win === 1 ? '胜' : h.win === -1 ? '负' : '平';
      var col = h.win === 1 ? C.gold : h.win === -1 ? '#d99a98' : C.dim;
      txt(ctx, tag, lx + 16, y + 19, 14, col, 'left', 600);
      txt(ctx, (h.score > 0 ? '+' : '') + (h.score || 0), lx + 56, y + 19, 15, col, 'left');
      txt(ctx, h.t ? new Date(h.t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
        lx + cw2 - 14, y + 19, 12, C.dim, 'right');
    });

    var top = (st.top || []);
    if (!top.length) txt(ctx, '还没有上榜成绩', rx, py + 262, 14, C.dim, 'left');
    top.forEach(function (r, i) {
      var y = py + 232 + i * 44;
      box(ctx, rx, y, cw2, 38, 10, 'rgba(20,34,54,0.72)', 'rgba(216,179,106,0.16)');
      txt(ctx, '第 ' + (i + 1), rx + 16, y + 19, 14, i === 0 ? C.gold : C.dim, 'left', 600);
      txt(ctx, (r.score > 0 ? '+' : '') + (r.score || 0) + ' 分',
        rx + 72, y + 19, 15, r.score > 0 ? C.gold : C.dim, 'left');
      txt(ctx, r.t ? new Date(r.t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric' }) : '',
        rx + cw2 - 14, y + 19, 12, C.dim, 'right');
    });

    box(ctx, state.W / 2 - 110, py + ph - 60, 220, 46, 12, C.btn, C.panelLine);
    txt(ctx, '关闭', state.W / 2, py + ph - 37, 16, C.text, 'center', 600);
    hits.push({ x: state.W / 2 - 110, y: py + ph - 60, w: 220, h: 46, act: 'statsClose' });
  }

  // ---------- 复盘 ----------
  function replayPanel(ctx, S, L, hits) {
    if (!S.replayOpen) return;
    var rows = (S.replay || []);
    var pw = 640, ph = 600;
    var px = (state.W - pw) / 2, py = (L.H - ph) / 2 - 30;
    overlay(ctx, L.H, state.W, pw);
    box(ctx, px, py, pw, ph, 16, C.panel, C.panelLine);
    txt(ctx, '上一局复盘', state.W / 2, py + 46, 22, C.gold, 'center', 600);
    txt(ctx, '按出牌顺序记录（过牌也记）', state.W / 2, py + 72, 13, C.dim, 'center');
    if (!rows.length) {
      txt(ctx, '这局还没有出牌记录', state.W / 2, py + 200, 16, C.dim, 'center');
    }
    var show = rows.slice(-11);
    show.forEach(function (r, i) {
      var y = py + 96 + i * 42;
      box(ctx, px + 24, y, pw - 48, 36, 9, 'rgba(20,34,54,0.72)', 'rgba(216,179,106,0.14)');
      txt(ctx, SEAT_NAMES[r.seat] || ('P' + r.seat), px + 42, y + 18, 14, r.seat === 0 ? C.gold : C.text, 'left', 600);
      var body = r.pass ? '过牌' : cardLine(r.cards || []);
      txt(ctx, body, px + 140, y + 18, 14, r.pass ? C.dim : C.text, 'left');
    });
    box(ctx, state.W / 2 - 110, py + ph - 62, 220, 46, 12, C.btn, C.panelLine);
    txt(ctx, '关闭', state.W / 2, py + ph - 39, 16, C.text, 'center', 600);
    hits.push({ x: state.W / 2 - 110, y: py + ph - 62, w: 220, h: 46, act: 'replayClose' });
  }

  function cardLine(cards) {
    var s = cards.slice(0, 6).map(function (c) { return SUIT[c.s] + rankText(c.r); }).join(' ');
    return cards.length > 6 ? s + ' …(' + cards.length + ' 张)' : s;
  }

  function guidePanel(ctx, S, L, hits) {
    if (!S.guideOpen) return;
    var page = Math.max(0, Math.min(2, S.guidePage || 0));
    var G = GUIDE_PAGES[page];
    var pw = 640, ph = 520;
    var px = (state.W - pw) / 2, py = (L.H - ph) / 2 - 30;
    overlay(ctx, L.H, state.W, pw);
    box(ctx, px, py, pw, ph, 16, C.panel, C.gold);
    txt(ctx, '新手引导 ' + (page + 1) + '/3', state.W / 2, py + 44, 15, C.dim, 'center');
    txt(ctx, G.t, state.W / 2, py + 82, 24, C.gold, 'center', 700);
    G.lines.forEach(function (ln, i) {
      var y = py + 130 + i * 52;
      box(ctx, px + 34, y - 24, 24, 24, 6, 'rgba(216,179,106,0.18)', C.panelLine);
      txt(ctx, String(i + 1), px + 46, y - 12, 14, C.gold, 'center', 600);
      txt(ctx, ln, px + 72, y - 12, 15, C.text, 'left');
    });
    var bwb = 150, bhb = 46;
    if (page > 0) {
      box(ctx, px + 34, py + ph - 62, bwb, bhb, 12, C.btn, C.panelLine);
      txt(ctx, '上一页', px + 34 + bwb / 2, py + ph - 39, 15, C.text, 'center');
      hits.push({ x: px + 34, y: py + ph - 62, w: bwb, h: bhb, act: 'guidePrev' });
    }
    box(ctx, px + pw - 34 - bwb, py + ph - 62, bwb, bhb, 12, C.gold, null);
    txt(ctx, page >= 2 ? '知道了' : '下一页', px + pw - 34 - bwb / 2, py + ph - 39, 16, '#101f33', 'center', 600);
    hits.push({
      x: px + pw - 34 - bwb, y: py + ph - 62, w: bwb, h: bhb,
      act: page >= 2 ? 'guideDone' : 'guideNext'
    });
    txt(ctx, '跳过', px + pw / 2 + 10, py + ph - 38, 14, C.dim, 'center');
    hits.push({ x: px + pw / 2 - 30, y: py + ph - 62, w: 80, h: 46, act: 'guideClose' });
  }

  // ---------- 对局内菜单 ----------
  function pausePanel(ctx, S, L, hits) {
    if (!S.pauseOpen) return;
    var pw = 640, ph = L.landscape ? 600 : 640;
    var px = (state.W - pw) / 2, py = (L.H - ph) / 2 - 20;
    overlay(ctx, L.H, state.W, pw);
    box(ctx, px, py, pw, ph, 16, C.panel, C.panelLine);
    txt(ctx, '对局菜单', state.W / 2, py + 46, 22, C.gold, 'center', 600);
    var st = S.stats || {};
    txt(ctx, (S.mode === 'online' ? '联机 · 房间 ' + (S.room || '-') : '试玩 · 三家 AI') +
      ' · 第 ' + Math.max(1, S.round) + '/' + S.rounds + ' 局 · 战绩 ' + (st.wins || 0) + ' 胜',
      state.W / 2, py + 72, 13, C.dim, 'center');

    var cw = (pw - 48 - 16) / 2, ch = 62;
    var gx = px + 24, gy = py + 92;
    var items = [
      { label: '返回主界面', sub: S.mode === 'online' ? '问一次再走 · 座位转托管' : '问一次再走 · 回标题', act: 'exitToMenu' },
      { label: S.auto ? '取消托管' : '托管', sub: S.auto ? '正在自动出牌' : '轮到你自动出最小牌', act: 'auto', on: !!S.auto },
      { label: '记牌器', sub: S.recordOpen ? '已展开' : '已收起', act: 'record', on: !!S.recordOpen },
      { label: '新手引导', sub: '3 页图解规则', act: 'guide' },
      { label: '我的战绩', sub: '胜率 / 连胜 / 排行榜', act: 'stats' },
      { label: '复盘回放', sub: '本局每一手出牌', act: 'replay' },
      { label: '分享战绩', sub: '本场分 + 连胜', act: 'share' },
      { label: '背景音乐', sub: S.musicOn ? '已开启' : '已关闭', act: 'music', on: !!S.musicOn },
      { label: '震动反馈', sub: S.vibOn ? '已开启' : '已关闭', act: 'vib', on: !!S.vibOn },
      { label: '牌背皮肤', sub: ['经典红', '青竹', '鎏金'][S.skin || 0], act: 'skin' }
    ];
    // 房主在联机局内多一个「解散房间」——只有点它才真的散桌
    if (S.mode === 'online' && S.isHost) {
      items.push({ label: '解散房间', sub: '房主专属 · 四人一起散', act: 'dissolve' });
    }
    items.forEach(function (it, i) {
      var c = i % 2, r = Math.floor(i / 2);
      toolButton(ctx, gx + c * (cw + 16), gy + r * (ch + 12), cw, ch,
        it.label, it.sub, !!it.on, it.act, hits, 0);
    });

    box(ctx, state.W / 2 - 110, py + ph - 60, 220, 46, 12, C.btn, C.panelLine);
    txt(ctx, '继续游戏', state.W / 2, py + ph - 37, 16, C.text, 'center', 600);
    hits.push({ x: state.W / 2 - 110, y: py + ph - 60, w: 220, h: 46, act: 'pauseClose' });
  }

  // 二次确认弹窗：退出本局 / 解散房间
  function askPanel(ctx, S, L, hits) {
    if (!S.ask) return;
    var H = L.H, pw = 560, ph = 320;
    var px = (state.W - pw) / 2, py = Math.max(12, (H - ph) / 2);
    overlay(ctx, H, state.W, H);
    box(ctx, px, py, pw, ph, 16, C.panel, C.panelLine);
    var ex = S.ask.kind === 'dissolve';
    txt(ctx, ex ? '解散房间？' : '退出本局？', state.W / 2, py + 56, 24, C.gold, 'center', 600);
    var sub = ex
      ? '房间会关闭：你回主界面，其他人回联机大厅'
      : (S.mode === 'online'
        ? '你的座位转机器人托管，房间不解散；要散桌请用「解散房间」'
        : '本局进度不保存，回到主界面');
    txt(ctx, sub, state.W / 2, py + 100, 14, C.dim, 'center');
    if (S.mode === 'online' && !ex) {
      txt(ctx, '有人在线时房间会继续', state.W / 2, py + 128, 13, C.dim, 'center');
    }

    var bw = 220, bh = 60, by = py + ph - 96;
    box(ctx, state.W / 2 - bw - 10, by, bw, bh, 12, ex ? 'rgba(140,47,42,0.92)' : C.gold, null);
    txt(ctx, ex ? '解散' : '退出', state.W / 2 - bw / 2 - 10, by + bh / 2, 18,
      ex ? '#ffe9dd' : '#101f33', 'center', 600);
    hits.push({ x: state.W / 2 - bw - 10, y: by, w: bw, h: bh, act: 'askYes' });

    box(ctx, state.W / 2 + 10, by, bw, bh, 12, C.btn, C.panelLine);
    txt(ctx, '取消', state.W / 2 + bw / 2 + 10, by + bh / 2, 18, C.text, 'center');
    hits.push({ x: state.W / 2 + 10, y: by, w: bw, h: bh, act: 'askNo' });
  }

  return { tribute, settle, menu, summary, testPanel, toast, lobbyPanel, roomPanel, chatName, chatPanel, chatBubbles, remainByRank, recordStrip, toolButton, toolsDrawer, statsPanel, replayPanel, cardLine, guidePanel, pausePanel, askPanel };
};