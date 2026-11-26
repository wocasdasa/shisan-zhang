// 牌桌主体：页头、座位、中央出牌区、手牌与操作条
// 依赖 views/base.js（由 views.js 拆分而来，函数体保持原样）
module.exports = function (B) {
  // 同名接住上层导出，函数体保持原样
  var state = B.state; // 共享可变状态，改的是 state 上的字段
  var C = B.C;
  var SEAT_NAMES = B.SEAT_NAMES;
  var SEAT_POS = B.SEAT_POS;
  var box = B.box;
  var clockChip = B.clockChip;
  var dealState = B.dealState;
  var drawBack = B.drawBack;
  var drawCard = B.drawCard;
  var easeOut = B.easeOut;
  var fxProgress = B.fxProgress;
  var kindLabel = B.kindLabel;
  var pill = B.pill;
  var rankText = B.rankText;
  var rr = B.rr;
  var txt = B.txt;

  // ---------- 页头 ----------
  function header(ctx, S, L, hits) {
    txt(ctx, '十三张·独食', 24, 44, 26, C.gold, 'left', 600);
    var online = S.mode === 'online';
    // 副标题收在标题正下方，左侧整块留给标题，右上角留给功能 chip
    txt(ctx, online ? ('联机' + (S.room ? ' · 房间 ' + S.room : ' · 未连接')) : '试玩 · 三家 AI',
      26, 66, 14, online ? C.gold : C.dim, 'left', 400);
    // 房间状态只做展示；离开牌桌统一走「主界面」二次确认，避免误触掉线

    var y = 26, h = 44, gap = 8, rad = 22, fs = 15;
    var x = state.W - 24;
    // 场次/对手/进贡/重开都是本地单机遗留；联机房间里的规则由房主在创建时设定，牌桌上不再出现
    if (!online) {
      x -= 78;
      box(ctx, x, y, 78, h, rad, C.btn, C.panelLine);
      txt(ctx, '重开', x + 39, y + h / 2, fs, C.text);
      hits.push({ x: x, y: y, w: 78, h: h, act: 'newMatch' });

      x -= gap + 86;
      box(ctx, x, y, 86, h, rad, C.btn, C.panelLine);
      txt(ctx, ['新手', '普通', '高手'][S.level] || '普通', x + 43, y + h / 2, fs, C.text);
      hits.push({ x: x, y: y, w: 86, h: h, act: 'level' });

      x -= gap + 86;
      box(ctx, x, y, 86, h, rad, C.btn, C.panelLine);
      txt(ctx, S.cfg.tributeTier === 'heavy' ? '重贡' : '轻贡', x + 43, y + h / 2, fs, C.text);
      hits.push({ x: x, y: y, w: 86, h: h, act: 'tier' });

      x -= gap + 78;
      box(ctx, x, y, 78, h, rad, C.btn, C.panelLine);
      txt(ctx, S.rounds + '局', x + 39, y + h / 2, fs, C.text);
      hits.push({ x: x, y: y, w: 78, h: h, act: 'round' });
    }

    // 音效开关
    x -= gap + 78;
    var on = S.audioOn !== false;
    box(ctx, x, y, 78, h, rad, on ? C.btn : 'rgba(16,28,46,0.55)',
      on ? C.panelLine : 'rgba(216,179,106,0.12)');
    txt(ctx, on ? '音效' : '静音', x + 39, y + h / 2, fs, on ? C.text : C.dim);
    hits.push({ x: x, y: y, w: 78, h: h, act: 'audio' });

    // 测试入口只在试玩/预览里出现；正式联机牌桌不暴露调试面板
    if (!online) {
      x -= gap + 78;
      box(ctx, x, y, 78, h, rad, 'rgba(216,179,106,0.16)', C.goldDim);
      txt(ctx, '测试', x + 39, y + h / 2, fs, C.gold);
      hits.push({ x: x, y: y, w: 78, h: h, act: 'testMenu' });
    }

    // 第二排：辅助工具（托管 / 记牌 / 更多），右对齐，避开左侧标题与副标题
    var y2 = 72, h2 = 36, fs2 = 14, rad2 = 18, gap2 = 8;
    var x2 = state.W - 24;
    x2 -= 78;
    box(ctx, x2, y2, 78, h2, rad2, S.toolsOpen ? 'rgba(216,179,106,0.22)' : C.btn,
      S.toolsOpen ? C.gold : C.panelLine);
    txt(ctx, '更多', x2 + 39, y2 + h2 / 2, fs2, S.toolsOpen ? C.gold : C.text);
    hits.push({ x: x2, y: y2, w: 78, h: h2, act: 'tools' });

    x2 -= gap2 + 78;
    var recOn = !!S.recordOpen;
    box(ctx, x2, y2, 78, h2, rad2, recOn ? 'rgba(216,179,106,0.22)' : C.btn,
      recOn ? C.gold : C.panelLine);
    txt(ctx, recOn ? '记牌●' : '记牌', x2 + 39, y2 + h2 / 2, fs2, recOn ? C.gold : C.text);
    hits.push({ x: x2, y: y2, w: 78, h: h2, act: 'record' });

    x2 -= gap2 + 78;
    var autoOn = !!S.auto;
    box(ctx, x2, y2, 78, h2, rad2, autoOn ? 'rgba(59,134,216,0.85)' : C.btn,
      autoOn ? 'rgba(255,255,255,0.45)' : C.panelLine);
    txt(ctx, autoOn ? '托管中' : '托管', x2 + 39, y2 + h2 / 2, fs2,
      autoOn ? '#ffffff' : C.text);
    hits.push({ x: x2, y: y2, w: 78, h: h2, act: 'auto' });

    // 引导：只手动点开，不自动弹
    x2 -= gap2 + 78;
    box(ctx, x2, y2, 78, h2, rad2, 'rgba(216,179,106,0.14)', C.goldDim);
    txt(ctx, '引导', x2 + 39, y2 + h2 / 2, fs2, C.gold);
    hits.push({ x: x2, y: y2, w: 78, h: h2, act: 'guide' });

    // 左上角：主界面（点了弹确认）+ 菜单
    var mx = 20, my = y2;
    box(ctx, mx, my, 84, h2, rad2, C.btn, C.panelLine);
    txt(ctx, '主界面', mx + 42, my + h2 / 2, fs2, C.text, 'center', 600);
    hits.push({ x: mx, y: my, w: 84, h: h2, act: 'exitHome' });

    var mx2 = mx + 84 + 8;
    box(ctx, mx2, my, 78, h2, rad2, S.pauseOpen ? 'rgba(216,179,106,0.22)' : C.btn,
      S.pauseOpen ? C.gold : C.panelLine);
    txt(ctx, '菜单', mx2 + 39, my + h2 / 2, fs2, S.pauseOpen ? C.gold : C.text, 'center', 600);
    hits.push({ x: mx2, y: my, w: 78, h: h2, act: 'pause' });
  }

  // ---------- 座位 ----------
  // 被抽走的牌在座位旁扇形展开：每张横移 18px（≥16）+ 纵移 8px 斜向下，避开邻座；
  // 牌 30×42，最多 5 张（超出取最后 5 张），每张 rank/suit 左角标完整可见。
  // dir=1 向右下展开（x=首张左边），dir=-1 向左下展开（x=首张右边，远端先画保住角标）。
  function drawnFan(ctx, cards, x, y, dir) {
    var show = cards.slice(-5);
    var cw = 30, ch = 42, stepX = 18, stepY = 8;
    dir = dir < 0 ? -1 : 1;
    var order = [];
    for (var i = 0; i < show.length; i++) order.push(i);
    if (dir < 0) order.reverse();
    order.forEach(function (i) {
      var cx = dir > 0 ? x + i * stepX : x - cw - i * stepX;
      var cy = y + i * stepY;
      ctx.save();
      ctx.translate(cx + cw / 2, cy + ch / 2);
      ctx.rotate(dir * (-0.05 + i * 0.025));
      drawCard(ctx, -cw / 2, -ch / 2, cw, ch, show[i], { mark: true });
      ctx.restore();
    });
  }

  function seatPlate(ctx, S, p, rect, hits) {
    var g = S.game;
    var pts = S.scores[p] || 0;
    var active = g && !g.over && g.turn === p && S.phase === 'play';
    var count = g ? g.players[p].hand.length : 0;
    var ds = dealState(S);
    if (ds && p !== 0) count = Math.min(count, ds.arrived[p]);
    if (ds && p === 0) count = Math.min(count, ds.arrived[0]);

    var rc = g ? (g.players[p].revealedCards || []) : [];
    // 联机视图里的身份牌是 {r:n} 对象，单机是数字：统一取 rank 值
    var rcRank = function (x) { return (x && typeof x === 'object') ? x.r : x; };
    var lone = rc.some(function (x) { return rcRank(x) === 3; }) &&
      rc.some(function (x) { return rcRank(x) === 14; });

    var compact = rect.w <= 130;
    // 新结构：左圆徽（直径 40）+ 名字 + 下行「N 张 · +分」
    var ar = Math.min(20, Math.max(14, Math.floor(rect.h / 2) - 6));
    var ax = rect.x + 8 + ar, ay = rect.y + rect.h / 2;
    box(ctx, rect.x, rect.y, rect.w, rect.h, 12, 'rgba(10,20,34,0.55)',
      lone ? C.red : active ? C.gold : 'rgba(216,179,106,0.22)');
    if (lone) { // 独食者：朱红边框常驻
      ctx.save();
      rr(ctx, rect.x, rect.y, rect.w, rect.h, 12);
      ctx.strokeStyle = C.red;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax, ay, ar, 0, Math.PI * 2);
    ctx.fillStyle = active ? 'rgba(216,179,106,0.28)' : 'rgba(216,179,106,0.12)';
    ctx.fill();
    ctx.strokeStyle = active ? C.gold : 'rgba(216,179,106,0.35)';
    ctx.lineWidth = active ? 2 : 1;
    ctx.stroke();
    ctx.restore();
    txt(ctx, SEAT_NAMES[p].charAt(0), ax, ay + 1, compact ? 15 : 17, active ? C.gold : C.text, 'center', 700);

    // 该家刚出牌：一圈金色脉冲
    if (S.fx && S.fx.seatPlay && S.fx.seatPlay.p === p) {
      var pe = fxProgress(S, 'seatPlay', 420);
      if (pe < 1) {
        ctx.save();
        var grow = 10 * easeOut(pe);
        ctx.globalAlpha = 0.55 * (1 - pe);
        rr(ctx, rect.x - grow, rect.y - grow, rect.w + grow * 2, rect.h + grow * 2, 12);
        ctx.strokeStyle = C.gold;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
      }
    }

    if (active) {
      ctx.save();
      ctx.shadowColor = 'rgba(216,179,106,0.45)';
      ctx.shadowBlur = 14;
      rr(ctx, rect.x, rect.y, rect.w, rect.h, 10);
      ctx.strokeStyle = C.goldDim;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // 名字（上行）+ 下行「N 张 · +分」（分数并入，不再挂右端）
    var lx = rect.x + 8 + ar * 2 + 8;
    var nameFs = compact ? 14 : 16;
    txt(ctx, SEAT_NAMES[p], lx, rect.y + rect.h / 2 - 11, nameFs, active ? C.gold : C.text, 'left', 600);
    var subFs = compact ? 11 : 12;
    var ly = rect.y + rect.h / 2 + 11;
    var pre = g ? (count + ' 张 · ') : '—';
    var ptsTxt = g ? ((pts > 0 ? '+' : '') + pts + '分') : '';
    // 极端值（13 张 + 三位数分）防溢出：整行量宽后缩字号，最低 9px
    var avail = rect.x + rect.w - 10 - lx;
    var fontOf = function (fs) {
      return '400 ' + fs + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
    };
    var lineW = function (fs) {
      ctx.font = fontOf(fs);
      return ctx.measureText(pre).width + (ptsTxt ? ctx.measureText(ptsTxt).width : 0);
    };
    while (subFs > 9 && lineW(subFs) > avail) subFs -= 1;
    txt(ctx, pre, lx, ly, subFs, C.dim, 'left');
    if (g) {
      ctx.font = fontOf(subFs);
      var off = ctx.measureText(pre).width;
      txt(ctx, ptsTxt, lx + off, ly, subFs,
        pts > 0 ? C.gold : pts < 0 ? '#d99a98' : C.dim, 'left', 600);
    }

    // 独食者：「独食」字常驻牌右上角
    if (lone) {
      txt(ctx, '独食', rect.x + rect.w - 8, rect.y + 12, 11, '#e8b0ae', 'right', 700);
    }
    // 队友提示：联机由服务端按房规下发 team；单机在这里按「关闭/出牌后/常显」自己算
    var showMate = false;
    if (S.mode === 'online') {
      showMate = !!(S.seats && S.seats[p] && S.seats[p].team === 0 && p !== 0);
    } else if (g && g.camp && g.camp.mode === 'team') {
      var th = (S.roomCfg && S.roomCfg.teamHint) || 'none';
      var anyReveal = g.players.some(function (pl) { return pl.revealedCards && pl.revealedCards.length; });
      if (p !== 0 && (th === 'always' || (th === 'reveal' && anyReveal))) {
        showMate = g.camp.teamA.indexOf(p) >= 0 === g.camp.teamA.indexOf(0) >= 0;
      }
    }
    if (showMate) txt(ctx, '队友', rect.x + rect.w - 8, rect.y + 12, 11, C.gold, 'right', 700);

    // 身份标记：黑金圆徽（♠3/♠A），南家在牌上方、其余在牌下方
    var br = 12, bn = rc.length;
    rc.forEach(function (r, i) {
      var cx = rect.x + rect.w / 2 + (i - (bn - 1) / 2) * (br * 2 + 6);
      var cy = (p === 0) ? rect.y - br - 2 : rect.y + rect.h + br + 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, br, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8,12,22,0.92)';
      ctx.fill();
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      txt(ctx, '♠' + rankText(rcRank(r)), cx, cy + 1, 11, C.gold, 'center', 600);
    });
  }

  function seats(ctx, S, L, hits) {
    for (var p = 0; p < 4; p++) {
      if (p === 0 && S.phase === 'tribute') continue; // 进贡面板会盖住南家座位
      var rect = L.seats[SEAT_POS[p]];
      seatPlate(ctx, S, p, rect, hits);
      // 联机只有当前轮到的那位胜方能抽（2v2 两名真人胜方时，不轮到的别亮金框；
      // 服务端 drawingSeat!==seat 会静默丢弃，亮框只会让人以为点了没反应）
      var TR0 = S.tribute;
      var fullSeat = !!(TR0 && TR0.pairQuota && TR0.plan && TR0.plan.winners &&
        TR0.plan.winners.length === 1 && ((TR0.drawnFrom || {})[p] || 0) >= TR0.pairQuota);
      var pickable = S.tribute && S.tribute.stage === 'draw' && S.tribute.humanIsWinner &&
        S.tribute.plan.losers.indexOf(p) >= 0 && !fullSeat &&
        (state.mode !== 'online' || S.tribute.myTurn);
      if (pickable) {
        ctx.save();
        ctx.setLineDash([6, 4]);
        rr(ctx, rect.x - 4, rect.y - 4, rect.w + 8, rect.h + 8, 12);
        ctx.strokeStyle = C.gold;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
        hits.push({ x: rect.x - 6, y: rect.y - 6, w: rect.w + 12, h: rect.h + 12, act: 'drawSeat', p: p });
      }

      // 进贡阶段：对手的牌全部盖住，只留牌背；标出抽牌者/被抽者，抽到的牌亮在头像旁
      var TR = S.tribute;
      if (TR && S.phase === 'tribute') {
          var posNm = SEAT_POS[p];
          if (posNm !== 'north') {
            var bkx = rect.x + rect.w + 8, bky = rect.y + rect.h - 36;
            if (posNm === 'east') bkx = rect.x - 34;
            for (var bk = 0; bk < 3; bk++) {
              ctx.save();
              ctx.translate(bkx + bk * 4, bky + bk * 3);
              ctx.rotate(-0.1 + bk * 0.06);
              drawBack(ctx, 0, 0, 22, 30);
              ctx.restore();
            }
          }
          // 服务端不下发 turnWRel/picks：联机时“当前抽牌者”就是本端自己（p0 不进这段循环），
          // 因此不能再用 turnW 判断，否则所有可抽座位会一直挂着“点我抽牌”
          var isTurn = state.mode === 'online' ? false : TR.turnW === p;
          var canPick = TR.stage === 'draw' && (TR.canDraw || []).indexOf(p) >= 0 && !fullSeat &&
            (state.mode !== 'online' || TR.myTurn);
          var wasPicked = (TR.picks || []).indexOf(p) >= 0;
          if (isTurn) {
            var pulse = 0.45 + 0.45 * Math.sin(Date.now() / 300);
            ctx.save();
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(233,184,77,' + pulse.toFixed(2) + ')';
            rr(ctx, rect.x - 7, rect.y - 7, rect.w + 14, rect.h + 14, 12);
            ctx.stroke();
            ctx.restore();
            txt(ctx, '抽牌中…', rect.x + rect.w / 2, rect.y - 13, 12, C.gold, 'center', 600);
          } else if (canPick) {
            var pulse2 = 0.55 + 0.4 * Math.sin(Date.now() / 240);
            ctx.save();
            if (ctx.setLineDash) ctx.setLineDash([6, 5]);
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = 'rgba(233,184,77,' + pulse2.toFixed(2) + ')';
            rr(ctx, rect.x - 9, rect.y - 9, rect.w + 18, rect.h + 18, 14);
            ctx.stroke();
            ctx.restore();
            if (posNm !== 'north') {
              // 横屏座位牌贴页头下沿，标注改挂在牌侧（与底部时钟同一套位），不压页头副标
              var bx1, by1;
              if (L.landscape) {
                // 横屏：挂在牌侧上角（同底部时钟位），不压页头副标、也不压牌旁的三张牌背
                bx1 = posNm === 'east' ? rect.x - 40 : rect.x + rect.w + 40;
                by1 = rect.y + 12;
              } else {
                bx1 = rect.x + rect.w / 2;
                by1 = rect.y - 21;
              }
              box(ctx, bx1 - 34, by1 - 11, 68, 22, 11, 'rgba(233,184,77,0.95)', null);
              txt(ctx, '点我抽牌', bx1, by1, 12, '#3b2a08', 'center', 600);
            }
          } else if (wasPicked) {
            box(ctx, rect.x - 2, rect.y + rect.h - 2, 40, 18, 6, 'rgba(176,42,47,0.92)', null);
            txt(ctx, '已抽', rect.x + 18, rect.y + rect.h + 7, 11, '#ffe9e0', 'center', 600);
          }
          // 被抽走的牌挂在他座位旁（亮出来）：按 TR.draws 逐座位过滤，扇形斜向下展开
          var drawnCards = (TR.draws || []).filter(function (d) { return d.from === p; })
            .map(function (d) { return d.card; });
          if (drawnCards.length) {
            var fDir = posNm === 'east' ? -1 : 1; // 西/北向右下、东向左下，避开邻座与屏幕边缘
            var fx0 = fDir > 0 ? rect.x + rect.w + 10 : rect.x - 10;
            drawnFan(ctx, drawnCards, fx0, rect.y + rect.h + 6, fDir);
          }
      }
      // 轮到谁出牌：时钟浮在他头上（自己的回合在底部按钮条里显示）
      if (p !== 0 && S.phase === 'play' && S.game && !S.game.over && S.game.turn === p) {
        var posName = SEAT_POS[p];
        var cx0, cy0;
        if (L.landscape) {
          // 横屏四家座位牌都贴桌边一行：时钟贴牌侧显示（东家放左侧朝内），
          // 不压页头副标、也不压牌下方的身份徽标
          cx0 = posName === 'east' ? rect.x - 24 : rect.x + rect.w + 24;
          cy0 = rect.y + rect.h / 2;
        } else {
          cx0 = rect.x + rect.w / 2;
          cy0 = posName === 'north' ? rect.y + rect.h + 22 : rect.y - 24;
          if (posName === 'south') { cx0 = rect.x + rect.w + 26; cy0 = rect.y + rect.h / 2; }
        }
        var r0 = 17;
        var hasTimer = S.timer.left > 0;
        var warn = hasTimer && S.timer.left <= 5;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx0, cy0, r0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,250,240,0.95)';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = warn ? '#d8412f' : '#e9b84d';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx0 - r0 * 0.44, cy0 - r0 * 0.94, r0 * 0.18, 0, Math.PI * 2);
        ctx.fillStyle = warn ? '#d8412f' : '#e9b84d';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx0 + r0 * 0.44, cy0 - r0 * 0.94, r0 * 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        if (hasTimer) {
          txt(ctx, String(S.timer.left), cx0, cy0 + 5, 15, warn ? '#d8412f' : '#5a3a12', 'center', 700);
        } else {
          var ang = (Date.now() % 1200) / 1200 * Math.PI * 2;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(cx0, cy0);
          ctx.lineTo(cx0 + Math.cos(ang - Math.PI / 2) * (r0 - 7), cy0 + Math.sin(ang - Math.PI / 2) * (r0 - 7));
          ctx.strokeStyle = '#5a3a12';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  // ---------- 桌面：本轮所有出牌 ----------
  function center(ctx, S, L, hits) {
    var g = S.game;
    var cy = L.center.y;

    if (!g) {
      txt(ctx, '点右上「重开」开始', state.W / 2, cy, 20, C.dim);
      return;
    }

    var ds = dealState(S);
    if (ds && !ds.done) { dealTable(ctx, S, L, ds); return; }

    var plays = g.trickPlays || [];
    if (!plays.length) {
      txt(ctx, S.phase === 'play' && g.turn >= 0 ? SEAT_NAMES[g.turn] + ' 起手' : '', state.W / 2, cy, 19, C.dim);
      return;
    }

    var newest = plays[plays.length - 1];
    var hist = plays.slice(0, -1).slice(-4);

    // 最新一手：放大居中
    var n = newest.cards.length;
    var gap = n >= 8 ? 6 : 12;
    var maxW = L.landscape ? Math.min(state.W - 220, 500) : Math.min(state.W - 260, 470);
    var chCap = L.landscape
      ? Math.max(56, (L.actions.y - 10) - (L.seats.north.y + L.seats.north.h) - 40)
      : 999;
    var cw = Math.floor((maxW - (n - 1) * gap) / n);
    cw = Math.max(28, Math.min(cw, Math.floor(chCap / 1.38), n <= 2 ? 90 : n <= 5 ? 64 : 42));
    var ch = Math.round(cw * 1.38);
    var blockW = n * cw + (n - 1) * gap;
    var cxB = state.W / 2;
    var x0 = cxB - blockW / 2;
    var yTop = Math.max(cy - ch / 2, L.seats.north.y + L.seats.north.h + 26);
    yTop = Math.min(yTop, L.actions.y - ch - 8);

    var raw = fxProgress(S, 'playT0', 300);
    if (raw < 0.58) {
      var prog = easeOut(raw / 0.58);
      var from = L.seats[SEAT_POS[newest.player]];
      var fx0 = from.x + from.w / 2, fy0 = from.y + from.h / 2;
      var fx1 = cxB, fy1 = yTop + ch / 2;
      var gx = fx0 + (fx1 - fx0) * prog;
      var gy = fy0 + (fy1 - fy0) * prog;
      var gw = cw * (0.58 + 0.42 * prog), gh = ch * (0.58 + 0.42 * prog);
      var mk = newest.cards[0].s === 3 && (newest.cards[0].r === 3 || newest.cards[0].r === 14);
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.45 * prog;
      ctx.translate(gx, gy);
      ctx.rotate((1 - prog) * (newest.player === 0 ? -0.16 : 0.16));
      for (var ci = newest.cards.length - 1; ci >= 0; ci--) {
        drawCard(ctx, -gw / 2 + ci * 9, -gh / 2 - ci * 3, gw, gh, newest.cards[ci],
          { mark: ci === 0 && mk });
      }
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.fillStyle = 'rgba(8,16,28,0.30)';
    rr(ctx, x0 - 16, yTop - 34, blockW + 32, ch + 52, 10);
    ctx.fill();
    ctx.restore();
    txt(ctx, SEAT_NAMES[newest.player] + (newest.combo ? ' · ' + kindLabel(newest.combo.kind) : ''),
      state.W / 2, yTop - 16, 13, C.gold, 'center', 600);

    newest.cards.forEach(function (c, i) {
      var mark = c.s === 3 && (c.r === 3 || c.r === 14);
      drawCard(ctx, x0 + i * (cw + gap), yTop, cw, ch, c, { mark: mark });
    });

    // 本轮之前的出牌：缩到最新一手右侧横排，保证一轮没结束前都看得到
    if (hist.length) {
      var hw = 26, hh = 34, hgap = 2;
      var hx = x0 + blockW + 20;
      var hy = yTop + 10;
      var maxX = state.W - 148;
      hist.forEach(function (pl) {
        var bw = pl.cards.length * (hw + hgap);
        if (hx + bw > maxX) return;
        box(ctx, hx - 4, hy - 4, bw + 8, hh + 8, 5, 'rgba(8,16,28,0.35)', 'rgba(216,179,106,0.22)');
        pl.cards.forEach(function (c, i) {
          var mark = c.s === 3 && (c.r === 3 || c.r === 14);
          drawCard(ctx, hx + i * (hw + hgap), hy, hw, hh, c, { mark: mark });
        });
        txt(ctx, SEAT_NAMES[pl.player].charAt(0), hx + 1, hy + hh + 12, 10, C.dim, 'left');
        hx += bw + 16;
      });
    }
  }

  // 发牌：牌堆 + 飞向座位的牌背
  function dealTable(ctx, S, L, ds) {
    var cy = L.center.y;
    var dw = 68, dh = 94;
    var dx = state.W / 2 - dw / 2, dy = cy - dh / 2;

    var left = ds.left;
    for (var i = 0; i < Math.min(4, left); i++) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      drawBack(ctx, dx + i * 3, dy - i * 3, dw, dh);
      ctx.restore();
    }
    txt(ctx, '发牌中 · 点击跳过', state.W / 2, cy + dh / 2 + 34, 16, C.dim);

    if (ds.flying) {
      var seat = ds.flying.seat;
      var pos = SEAT_POS[seat];
      var r = L.seats[pos];
      var tx = r.x + r.w / 2, ty = r.y - 6;
      var p = easeOut(ds.flying.prog);
      var fx = dx + dw / 2 + (tx - (dx + dw / 2)) * p;
      var fy = dy + dh / 2 + (ty - (dy + dh / 2)) * p;
      var sc = 0.82 - 0.18 * p;
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate((1 - p) * (seat === 0 ? -0.18 : 0.18));
      ctx.globalAlpha = 0.95;
      drawBack(ctx, -dw * sc / 2, -dh * sc / 2, dw * sc, dh * sc);
      ctx.restore();
    }
  }

  // ---------- 手牌 ----------
  function hand(ctx, S, L, hits) {
    var g = S.game;
    var mine = g ? g.players[0].hand : [];
    var ds = dealState(S);
    var n = ds && !ds.done ? Math.min(mine.length, ds.arrived[0]) : mine.length;
    // 手牌整行居中：南家座位牌已移到手牌正上方，不再占用左侧空间（竖/横屏一致）
    var avail = state.W - 48 - L.hand.cardW;
    var step = n > 1 ? Math.min(L.hand.step, Math.max(26, avail / (n - 1))) : L.hand.step;
    var totalW = (n - 1) * step + L.hand.cardW;
    var hx = Math.max(24, Math.round((state.W - totalW) / 2));

    mine.slice(0, n).forEach(function (c, i) {
      var sel = S.selected.some(function (s) { return s.r === c.r && s.s === c.s; });
      var x = hx + i * step;
      var y = L.hand.y - (sel ? 24 : 0);
      drawCard(ctx, x, y, L.hand.cardW, L.hand.cardH, c, { mark: sel });
      hits.push({ x: x, y: y, w: Math.min(step, L.hand.cardW), h: L.hand.cardH, act: 'card', i: i });
    });

    // 最后一张补足宽度
    if (n) {
      var lastX = hx + (n - 1) * step;
      hits.push({ x: lastX + step, y: L.hand.y, w: Math.max(0, L.hand.cardW - step), h: L.hand.cardH, act: 'card', i: n - 1 });
    }
  }

  // ---------- 操作区 ----------
  function actions(ctx, S, L, hits) {
    var g = S.game;
    var can = S.phase === 'play' && g && !g.over && g.turn === 0 && !S.busy;

    // 只有轮到自己才浮出操作条
    if (!can) return;

    var barH = 44;
    // 操作条迁入 layout 的 actions 区（竖屏为底部带，远离南家座位牌，消除叠压）
    var barY = L.actions.y + (L.actions.h - barH) / 2;
    var wHint = 108, wPass = 108, wPlay = 126, gapB = 12;
    var total = wHint + gapB + wPass + gapB + wPlay;
    // 操作条避开头像块：在「头像右侧 ~ 屏幕右边距」这段里居中（不再按整屏中线，偏右一点）
    var plate = L.seats.south;
    var zoneL = plate.x + plate.w + 12, zoneR = state.W - 16;
    var bx = Math.round((zoneL + zoneR) / 2 - total / 2);
    bx = Math.max(zoneL, Math.min(bx, zoneR - total));

    pill(ctx, bx, barY, wHint, barH, '提示', can, hits, 'hint', 'gold');
    bx += wHint + gapB;

    pill(ctx, bx, barY, wPass, barH, '不出', can && g && !!g.combo, hits, 'pass', 'gold');
    bx += wPass + gapB;

    // 倒计时嵌在「出牌」按钮左侧：复用 clockChip 画法（半径 14），剩余秒数在环心
    pill(ctx, bx, barY, wPlay, barH, '出牌', can, hits, 'play', 'blue', 20);
    clockChip(ctx, bx + 26, barY + barH / 2, 14, S.timer.left, S.phase === 'play');
  }

  // 发言入口（联机）：常驻在操作带最右侧，不随「轮到你」显隐
  function chatEntry(ctx, S, L, hits) {
    if (S.mode !== 'online' || !S.room) return;
    var w = 64, h = 44;
    var x = state.W - 16 - w, y = L.actions.y + (L.actions.h - h) / 2;
    pill(ctx, x, y, w, h, '发言', true, hits, 'chatOpen', 'gold');
  }

  return { header, drawnFan, seatPlate, seats, center, dealTable, hand, actions, chatEntry };
};