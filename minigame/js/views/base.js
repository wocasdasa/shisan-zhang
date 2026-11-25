// 绘制原语、几何与特效：不依赖任何其它视图模块
// 由 views.js 拆分而来；state 里的 W/lastH/SKIN 是跨模块共享的可变状态
// 改动这里等于改所有界面，改完跑 node tools/shot-matrix.js 做像素回归
module.exports = function () {

  // 跨函数共享的可变状态：横屏宽 / 画布高 / 牌背皮肤
  var state = { W: 750, lastH: 0, SKIN: 0 };

  var C = {
    bg0: '#0a121f',
    bg1: '#16273f',
    felt: '#1a2f4d',
    gold: '#d8b36a',
    goldDim: 'rgba(216,179,106,0.5)',
    text: '#f2ead8',
    dim: '#93a3ba',
    paper: '#fdfaf0',
    paper2: '#efe7d3',
    red: '#c8452c',
    ink: '#1d2620',
    panel: '#0f1b2e',
    panelLine: 'rgba(216,179,106,0.28)',
    btn: '#1c2f4a',
    danger: '#c0504d'
  };

  var SEAT_NAMES = ['你', '西家', '北家', '东家'];
  var SEAT_POS = ['south', 'west', 'north', 'east'];
  var SUIT = ['♦', '♣', '♥', '♠'];
  var RANK_TXT = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

  function rankText(r) { return RANK_TXT[r] || String(r); }
  function isRed(c) { return c.s === 0 || c.s === 2; }

  // 竖屏/横屏共用同一套几何语义：座位牌 176×64 沿桌边一行、出牌区居中偏上、
  // 手牌底排居中、操作条底部成组。横屏设计高恒为 750（宽随屏幕比例伸缩），
  // 所以这套「以底边为锚」的绝对节奏在两种方向都成立（竖屏 1334 高只是上下更宽松）。
  function layout(H) {
    var landscape = (state.W / H) >= 1.2;
    var headerH = 118;                 // 第二排工具 chip 需要高度（托管/记牌/更多）
    var seatW = 176, seatH = 64;
    var rowY = headerH + 8;            // 顶排座位牌紧贴页头下沿
    var handY = H - 152;               // 手牌顶边：底部留 手牌 100 + 52 边距（手牌贴底排）
    var tableTop = rowY + seatH + 8;   // 内框顶边顺到顶排座位牌之下（不再横穿座位牌/抽牌扇形）
    return {
      H: H,
      headerH: headerH,
      landscape: landscape,
      table: { top: tableTop, bottom: handY - 96 },
      seats: {
        north: { x: state.W / 2 - seatW / 2, y: rowY, w: seatW, h: seatH },
        west: { x: 22, y: rowY, w: seatW, h: seatH },
        east: { x: state.W - 22 - seatW, y: rowY, w: seatW, h: seatH },
        // 自家座位牌回到操作条左侧（底部整条带子仍是手牌）；操作条整组避开它、往右排
        south: { x: 20, y: (H - 232) + (74 - seatH) / 2, w: 148, h: seatH }
      },
      // 出牌区居中偏上：横屏牌桌带更矮，取 0.42H；竖屏维持 0.40H
      center: { y: Math.round(H * (landscape ? 0.42 : 0.40)) },
      hand: {
        y: handY,
        cardW: 70,
        cardH: 100,
        step: 56
      },
      // 操作条（提示/不出/出牌）移到手牌正上方，与手牌留 6px 间距
      actions: { y: handY - 80, h: 74 }
    };
  }

  // ---------- 基础绘制 ----------
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function box(ctx, x, y, w, h, r, fill, stroke) {
    rr(ctx, x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  }

  // 牌背皮肤：0 经典红 / 1 青竹 / 2 鎏金（S.skin 决定，draw 时同步）
  var SKINS = [
    { fill: '#8c2f2a', line: 'rgba(255,225,205,0.5)', deco: 'rgba(255,225,205,0.35)' },
    { fill: '#2b5c47', line: 'rgba(214,240,225,0.5)', deco: 'rgba(214,240,225,0.32)' },
    { fill: '#6d5423', line: 'rgba(255,238,196,0.55)', deco: 'rgba(255,238,196,0.35)' }
  ];



  function txt(ctx, s, x, y, size, color, align, weight) {
    ctx.font = (weight || 400) + ' ' + size + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = color || C.text;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  }

  function bg(ctx, L) {
    var H = L.H;
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.bg1);
    g.addColorStop(0.45, C.felt);
    g.addColorStop(1, C.bg0);
    ctx.fillStyle = g;
    ctx.fillRect(-12, -12, state.W + 24, H + 24); // 外扩 12px：四条震屏 translate 时不露白边

    // 牌桌内框：顶边起于顶排座位牌之下（竖横屏同一来源，见 layout 的 tableTop）
    var pad = 48;
    var inner = {
      x: pad,
      y: L.table.top,
      w: state.W - pad * 2,
      h: L.table.bottom - L.table.top
    };
    box(ctx, inner.x, inner.y, inner.w, inner.h, 26, null, 'rgba(216,179,106,0.16)');

    // 水印（放两侧留白，避免压住出牌区）
    ctx.save();
    ctx.globalAlpha = 0.07;
    txt(ctx, '♠', inner.x + inner.w * 0.16, inner.y + inner.h * 0.3, Math.min(state.W, H) * 0.16, '#ffffff');
    txt(ctx, '♠', inner.x + inner.w * 0.84, inner.y + inner.h * 0.74, Math.min(state.W, H) * 0.16, '#ffffff');
    ctx.restore();
  }

  // ---------- 一张牌 ----------
  function drawCard(ctx, x, y, w, h, card, opt) {
    opt = opt || {};
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.42)';
    ctx.shadowBlur = Math.max(4, h * 0.08);
    ctx.shadowOffsetY = Math.max(2, h * 0.05);
    box(ctx, x, y, w, h, Math.max(4, w * 0.08), C.paper, 'rgba(0,0,0,0.18)');
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    var color = isRed(card) ? C.red : C.ink;
    txt(ctx, rankText(card.r), x + w * 0.14, y + h * 0.15, Math.round(h * 0.24), color, 'left', 600);
    txt(ctx, SUIT[card.s], x + w * 0.14, y + h * 0.36, Math.round(h * 0.17), color, 'left', 400);

    ctx.save();
    ctx.globalAlpha = 0.5;
    txt(ctx, SUIT[card.s], x + w * 0.78, y + h * 0.78, Math.round(h * 0.3), color, 'center', 400);
    ctx.restore();

    if (opt.mark) {
      rr(ctx, x - 1, y - 1, w + 2, h + 2, Math.max(5, w * 0.09));
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (opt.dim) {
      ctx.fillStyle = 'rgba(10,20,34,0.35)';
      rr(ctx, x, y, w, h, Math.max(4, w * 0.08));
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBack(ctx, x, y, w, h) {
    var sk = SKINS[state.SKIN] || SKINS[0];
    var r = Math.max(4, w * 0.08);
    box(ctx, x, y, w, h, r, sk.fill, sk.line);
    ctx.save();
    rr(ctx, x, y, w, h, r);
    ctx.clip();
    ctx.strokeStyle = sk.deco;
    ctx.lineWidth = 1;
    var step = Math.max(6, w / 9);
    for (var i = -h; i < w; i += step) {
      ctx.beginPath();
      ctx.moveTo(x + i, y + h);
      ctx.lineTo(x + i + h, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- 发牌动画状态 ----------
  var DEAL_ORDER = [0, 3, 2, 1];

  function dealState(S) {
    if (!S.deal || !S.deal.t0) return null;
    var per = S.deal.per;
    var elapsed = Math.max(0, Date.now() - S.deal.t0);
    var idx = Math.floor(elapsed / per);
    var arrived = [0, 0, 0, 0];
    for (var k = 0; k < Math.min(idx, 52); k++) arrived[DEAL_ORDER[k % 4]]++;
    var flying = null;
    if (idx < 52) {
      var prog = Math.min(1, (elapsed - idx * per) / per);
      flying = { seat: DEAL_ORDER[idx % 4], prog: prog };
    }
    return { arrived: arrived, flying: flying, done: idx >= 52, left: Math.max(0, 52 - idx) };
  }

  function easeOut(p) { return 1 - Math.pow(1 - p, 3); }

  // ---------- 特效层 ----------
  function ring(ctx, cx, cy, r, p, rgb) {
    var k = easeOut(p);
    ctx.save();
    ctx.strokeStyle = 'rgba(' + (rgb || '255,216,140') + ',' + (0.72 * (1 - p)).toFixed(3) + ')';
    ctx.lineWidth = 3.2 * (1 - p) + 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r * (0.55 + 0.45 * k), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function burst(ctx, cx, cy, p, count, radius, rgb) {
    ctx.save();
    for (var i = 0; i < count; i++) {
      var a = (i / count) * Math.PI * 2 + (i % 3) * 0.18;
      var d = radius * easeOut(p) * (0.68 + ((i * 37) % 34) / 100);
      var x = cx + Math.cos(a) * d;
      var y = cy + Math.sin(a) * d * 0.62;
      ctx.fillStyle = 'rgba(' + rgb + ',' + Math.max(0, 1 - p).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(x, y, 2.4 * (1 - p) + 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  var CONFETTI_COLORS = ['255,216,140', '247,240,214', '226,120,92', '150,210,170'];

  function confetti(ctx, S, p, H) {
    var n = 22;
    ctx.save();
    for (var i = 0; i < n; i++) {
      var seed = (i * 73 + 11) % 997;
      var x = (seed / 997) * (state.W - 40) + 20 + Math.sin(p * 5 + i) * 22;
      var y = -30 + easeOut(Math.min(1, p * 1.15)) * (H + 80) * (0.35 + ((i * 29) % 60) / 100);
      var col = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p * 1.05);
      ctx.translate(x, y);
      ctx.rotate(p * 6 + i);
      ctx.fillStyle = 'rgba(' + col + ',1)';
      ctx.fillRect(-3, -5, 6, 10);
      ctx.restore();
    }
    ctx.restore();
  }

  // 同花粒子颜色：按该手牌实际花色（♠ 银白 / ♥ 朱红 / ♣ 翠绿 / ♦ 鎏金）
  var FLUSH_RGB = { 0: '255,216,140', 1: '90,200,140', 2: '224,90,70', 3: '226,232,240' };

  function flushRgb(cards) {
    if (cards && cards.length && cards[0] && FLUSH_RGB[cards[0].s]) return FLUSH_RGB[cards[0].s];
    return '150,220,255'; // 无牌面信息（如 demo 未指定 suit）时的兜底色
  }

  // 牌型横幅：居中偏上金色立体字，缩放 0.6→1.1→1.0 弹入（前 30%），停留，末段上移淡出
  function banner(ctx, text, p, L) {
    var s = 1, a = 1, dy = 0;
    if (p < 0.3) {
      var t = p / 0.3;
      s = t < 0.6 ? 0.6 + 0.5 * easeOut(t / 0.6) : 1.1 - 0.1 * easeOut((t - 0.6) / 0.4);
      a = Math.min(1, t * 4);
    } else if (p > 0.7) {
      var u = easeOut((p - 0.7) / 0.3);
      dy = -44 * u;
      a = 1 - u;
    }
    if (a <= 0) return;
    // 字号按短边取：竖屏=750 宽，横屏=750 高，避免横屏 W（可 1333+）把字放大到压住出牌区
    var size = L.landscape
      ? Math.max(30, Math.round(Math.min(state.W, L.H) * 0.045))
      : Math.max(30, Math.round(state.W * 0.058));
    // 横屏牌桌带只有 ~210 高：横幅贴内框上沿，与出牌区标题留出间隙；竖屏保持 0.30H 定稿位
    var cy = L.landscape ? L.table.top + 24 : Math.round((state.lastH || 640) * 0.30);
    ctx.save();
    ctx.translate(state.W / 2, cy);
    ctx.scale(s, s);
    ctx.globalAlpha = Math.max(0, Math.min(1, a));
    ctx.font = '700 ' + size + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 立体纵深：两层深色偏移垫底
    ctx.fillStyle = 'rgba(72,46,14,0.85)';
    ctx.fillText(text, 0, size * 0.10);
    ctx.fillStyle = 'rgba(122,82,28,0.9)';
    ctx.fillText(text, 0, size * 0.05);
    // 金色渐变正面 + 微辉光
    var g = ctx.createLinearGradient(0, -size * 0.55, 0, size * 0.55);
    g.addColorStop(0, '#fff6cc');
    g.addColorStop(0.45, '#ffd873');
    g.addColorStop(1, '#d9a441');
    ctx.fillStyle = g;
    ctx.shadowColor = 'rgba(255,214,120,0.55)';
    ctx.shadowBlur = size * 0.28;
    ctx.fillText(text, 0, 0);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(96,62,16,0.65)';
    ctx.lineWidth = Math.max(1, size * 0.028);
    ctx.strokeText(text, 0, 0);
    ctx.restore();
  }

  // 震屏：四条（出牌即震）与独食砸字（0.45×1600=720ms 起震）共用判定；±6px 随机偏移，300ms 线性衰减
  function fxShake(S) {
    var el;
    if (S.fxDemoP !== undefined && S.fxDemoP !== null) {
      if (S.fxDemoKind === 'lone') el = (S.fxDemoP - 0.45) * 1600;
      else if (S.fxDemoKind === 'four') el = S.fxDemoP * 640;
      else return null;
    } else {
      if (!S.fx) return null;
      var now = Date.now();
      // 四条在其 300ms 窗口内优先（最新事件），独食窗口（720-1020ms）补充
      if (S.fx.kind === 'four' && S.fx.playT0 && now - S.fx.playT0 < 300) el = now - S.fx.playT0;
      else if (S.fx.loneRevealT0) el = now - S.fx.loneRevealT0 - 720;
      else return null;
    }
    if (el < 0 || el >= 300) return null;
    var amp = 6 * (1 - el / 300);
    return { x: (Math.random() * 2 - 1) * amp, y: (Math.random() * 2 - 1) * amp };
  }

  // Canvas 路径画 ♠（x,y 为中心，size 为总高）
  function drawSpade(ctx, x, y, size, fill) {
    var s = size;
    ctx.save();
    ctx.fillStyle = fill || '#f2ead8';
    ctx.beginPath();
    ctx.moveTo(x, y - s * 0.5);
    ctx.bezierCurveTo(x - s * 0.58, y - s * 0.10, x - s * 0.52, y + s * 0.28, x - s * 0.16, y + s * 0.28);
    ctx.bezierCurveTo(x - s * 0.07, y + s * 0.28, x - s * 0.02, y + s * 0.22, x, y + s * 0.13);
    ctx.bezierCurveTo(x + s * 0.02, y + s * 0.22, x + s * 0.07, y + s * 0.28, x + s * 0.16, y + s * 0.28);
    ctx.bezierCurveTo(x + s * 0.52, y + s * 0.28, x + s * 0.58, y - s * 0.10, x, y - s * 0.5);
    ctx.closePath();
    ctx.fill();
    // 茎：向上收窄的三角
    ctx.beginPath();
    ctx.moveTo(x - s * 0.12, y + s * 0.52);
    ctx.lineTo(x, y + s * 0.10);
    ctx.lineTo(x + s * 0.12, y + s * 0.52);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ♠3/♠A 身份特效（三幕）：落点黑金光柱(0-0.2) → 12 枚 ♠ 粒子炸开(全程) →
  // 身份徽标（黑金圆章，内嵌 ♠3/♠A）自桌中央沿二次贝塞尔飞入 L.seats[seat]（0.35-1.0）。
  // 徽标落点与 seatPlate 的身份徽标公式一致（br=12，南家在牌上方、其余在牌下方）。
  function identityFx(ctx, S, L, p, seat, rank) {
    if (typeof seat !== 'number' || seat < 0 || seat > 3) seat = 2;
    if (rank !== 3 && rank !== 14) rank = 3;
    var cx = state.W / 2;
    var cy = Math.min(L.center.y, L.hand.y - 90);
    var rect = L.seats[SEAT_POS[seat]];
    var br = 12;
    var rc = (S.game && S.game.players[seat] && S.game.players[seat].revealedCards) || [rank];
    var bn = rc.length;
    var bi = rc.indexOf(rank);
    if (bi < 0) bi = bn - 1;
    var tx = rect.x + rect.w / 2 + (bi - (bn - 1) / 2) * (br * 2 + 6);
    var ty = (seat === 0) ? rect.y - br - 2 : rect.y + rect.h + br + 2;

    // 第一幕：落点黑金光柱（0-0.2，余光至 0.24）
    if (p < 0.24) {
      var t1 = Math.min(1, p / 0.2);
      var a1 = p <= 0.2 ? easeOut(t1) : Math.max(0, 1 - (p - 0.2) / 0.04);
      var gTop = L.table.top + 6;
      var gBot = Math.min(L.hand.y - 40, L.table.bottom);
      ctx.save();
      ctx.globalAlpha = 0.85 * a1;
      var grad = ctx.createLinearGradient(0, gTop, 0, gBot);
      grad.addColorStop(0, 'rgba(216,179,106,0)');
      grad.addColorStop(0.5, 'rgba(255,224,150,0.9)');
      grad.addColorStop(1, 'rgba(216,179,106,0)');
      ctx.fillStyle = grad;
      var pw = 26 * (0.4 + 0.6 * easeOut(t1));
      ctx.fillRect(cx - pw / 2, gTop, pw, gBot - gTop);
      ctx.restore();
      ring(ctx, cx, cy, 90, t1, '216,179,106');
    }

    // 第二幕：12 枚 ♠ 粒子自落点炸开（全程，金/银交替）。
    // 粒子预算：settle 彩带（confetti 22 枚）活跃期内跳过本组粒子——
    // 否则「黑桃同花顺（含♠A）收尾」场景 34+22+12=68 会突破同屏 ≤60 硬约束
    var settleOn = S.fx && S.fx.settleT0 && (Date.now() - S.fx.settleT0) < 1020;
    if (!settleOn) {
      ctx.save();
      for (var i = 0; i < 12; i++) {
        var ang = (i / 12) * Math.PI * 2 + 0.26;
        var dist = 120 * easeOut(p) * (0.62 + ((i * 41) % 38) / 100);
        var px = cx + Math.cos(ang) * dist;
        var py = cy + Math.sin(ang) * dist * 0.66;
        var sz = 15 * (1 - p * 0.55) + 3;
        ctx.globalAlpha = Math.max(0, 0.95 - p * 0.9);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(ang + p * 2.2);
        drawSpade(ctx, 0, 0, sz, i % 2 ? '#e8b04a' : '#dfe6f0');
        ctx.restore();
      }
      ctx.restore();
    }

    // 第三幕：身份徽标自桌中央沿二次贝塞尔飞入座位徽标位（0.35-1.0）
    if (p >= 0.35) {
      var t3 = easeOut(Math.min(1, (p - 0.35) / 0.65));
      var mx = (cx + tx) / 2;
      var my = Math.min(cy, ty) - 90;
      var bx = (1 - t3) * (1 - t3) * cx + 2 * (1 - t3) * t3 * mx + t3 * t3 * tx;
      var by = (1 - t3) * (1 - t3) * cy + 2 * (1 - t3) * t3 * my + t3 * t3 * ty;
      var bsize = 26 - 14 * t3; // 26 → 12，与座位身份徽标半径吻合
      ctx.save();
      ctx.shadowColor = 'rgba(255,214,120,0.6)';
      ctx.shadowBlur = 12 * (1 - t3) + 3;
      ctx.beginPath();
      ctx.arc(bx, by, bsize, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8,12,22,0.95)';
      ctx.fill();
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      txt(ctx, '♠' + rankText(rank), bx, by + 1, Math.max(9, Math.round(bsize * 0.95)), C.gold, 'center', 600);
    }
  }

  // 独食全屏揭示（总时长约 1600ms，两幕）：桌面压暗至 40%（全程，末 15% 淡出避免硬切）→
  // ♠3/♠A 双牌面自两侧飞入中央合并放大至 1.6 倍（0-0.45）→
  //「独食」朱红大字 2.2→1.0 砸下 + 震屏（见 fxShake）+ 黑红粒子爆发（0.45-1.0）。
  // 结束后画面归零，仅剩 seatPlate 的朱红边框常驻；座位高亮脉冲只在 T3 结构之外叠加。
  function loneRevealFx(ctx, S, L, H, p, seat) {
    if (p >= 1) return; // 结束后：特效层清空，独食者座位朱红边框常驻
    var cx = state.W / 2;
    // 横屏牌桌带更矮：整体上移到内框上沿下方，保证「独食」大字落在带内（不压底排座位牌/手牌）
    var cy = L.landscape ? L.table.top + 72 : Math.min(L.center.y, L.hand.y - 90);
    var fade = p > 0.85 ? Math.max(0, 1 - (p - 0.85) / 0.15) : 1;

    // 全程：桌面压暗至 40%（前 20% 淡入）
    var dimA = 0.4 * Math.min(1, p / 0.2) * fade;
    ctx.save();
    ctx.fillStyle = 'rgba(4,8,16,' + dimA.toFixed(3) + ')';
    ctx.fillRect(0, 0, state.W, H);
    ctx.restore();

    // 第一幕（0-0.45）：♠3/♠A 自左右两侧飞入中央合并，放大至 1.6 倍；落定后保持
    var t = easeOut(Math.min(1, p / 0.45));
    var cw = 58 * (1 + 0.6 * t);
    var ch = 82 * (1 + 0.6 * t);
    var gap = cw * 0.3;
    var x3 = -70 + (cx - gap + 70) * t;
    var xA = state.W + 70 + (cx + gap - state.W - 70) * t;
    var r3 = -0.55 * (1 - t) - 0.06;
    var rA = 0.55 * (1 - t) + 0.06;
    var cardA = Math.min(1, p / 0.08) * fade;
    ctx.save();
    ctx.globalAlpha = cardA;
    ctx.save();
    ctx.translate(x3, cy);
    ctx.rotate(r3);
    drawCard(ctx, -cw / 2, -ch / 2, cw, ch, { s: 3, r: 3 });
    ctx.restore();
    ctx.save();
    ctx.translate(xA, cy);
    ctx.rotate(rA);
    drawCard(ctx, -cw / 2, -ch / 2, cw, ch, { s: 3, r: 14 });
    ctx.restore();
    ctx.restore();

    // 第二幕（0.45-1.0）：「独食」朱红大字 2.2→1.0 砸下 + 黑红粒子爆发
    if (p >= 0.45) {
      var q = (p - 0.45) / 0.55;
      var sq = easeOut(Math.min(1, q * 1.6)); // 快砸：前段完成大部分缩放
      // 字号按短边取：横屏（W 远大于 H）不再被 W 放大到压住底排
      var size = Math.max(44, Math.round((L.landscape ? Math.min(state.W, H) : state.W) * 0.085));
      var ty = cy + ch / 2 + 46;
      // 黑红粒子爆发：13 黑 + 13 朱红 = 26 枚（预算推导见 task-7 报告）
      burst(ctx, cx, ty, q, 13, 190, '20,24,32');
      burst(ctx, cx, ty, q, 13, 215, '224,96,74');
      ctx.save();
      ctx.globalAlpha = Math.min(1, q * 6) * fade;
      ctx.translate(cx, ty);
      var tscale = 2.2 - 1.2 * sq;
      ctx.scale(tscale, tscale);
      ctx.font = '700 ' + size + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(200,69,44,0.65)';
      ctx.shadowBlur = size * 0.3;
      ctx.fillStyle = C.red;
      ctx.fillText('独食', 0, 0);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(40,10,8,0.8)';
      ctx.lineWidth = Math.max(1.5, size * 0.03);
      ctx.strokeText('独食', 0, 0);
      ctx.restore();

      // 尾声（0.55-1.0）：独食者座位朱红脉冲，衔接 seatPlate 常驻边框（纯叠加，不动 T3 结构）
      if (typeof seat === 'number' && seat >= 0 && seat <= 3 && p > 0.55) {
        var srect = L.seats[SEAT_POS[seat]];
        var u = (p - 0.55) / 0.45;
        var grow = 8 * easeOut(u);
        ctx.save();
        ctx.globalAlpha = 0.7 * (1 - u) * fade;
        rr(ctx, srect.x - grow, srect.y - grow, srect.w + grow * 2, srect.h + grow * 2, 12);
        ctx.strokeStyle = C.red;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // 牌型专属特效：环数、色带、闪光按牌型递进；非单张叠加横幅；cards 为该手牌数组（供同花着色）
  function kindFx(ctx, S, L, H, k, p, cards) {
    var cx = state.W / 2;
    var cy = Math.min(L.center.y, L.hand.y - 90);
    var fade = Math.max(0, 1 - p);
    if (k === 'pair') {
      ring(ctx, cx, cy, 96, Math.min(1, p), '255,214,128');
      ring(ctx, cx, cy, 118, Math.min(1, p + 0.28), '255,238,190');
    } else if (k === 'trio') {
      ring(ctx, cx, cy, 104, Math.min(1, p), '255,206,120');
      ring(ctx, cx, cy, 128, Math.min(1, p + 0.18), '255,178,96');
      ring(ctx, cx, cy, 152, Math.min(1, p + 0.34), '255,226,170');
    } else if (k === 'straight') {
      // 流线 7 条，首尾加辉光点
      for (var i = 0; i < 7; i++) {
        var d = easeOut(Math.min(1, Math.max(0, p * 1.4 - i * 0.08)));
        var ly = cy + (i - 3) * 13;
        var bw = 120 + d * 200;
        ctx.save();
        ctx.globalAlpha = 0.55 * fade;
        ctx.strokeStyle = 'rgba(160,214,255,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - bw / 2, ly);
        ctx.lineTo(cx + bw / 2, ly);
        ctx.stroke();
        ctx.restore();
        if (d > 0.05) {
          ctx.save();
          ctx.globalAlpha = 0.85 * fade;
          ctx.fillStyle = 'rgba(216,240,255,1)';
          ctx.shadowColor = 'rgba(160,214,255,0.95)';
          ctx.shadowBlur = 9;
          var gr = 2.2 + 1.6 * d;
          ctx.beginPath(); ctx.arc(cx - bw / 2, ly, gr, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(cx + bw / 2, ly, gr, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
      burst(ctx, cx, cy, p, 16, 150, '160,214,255');
    } else if (k === 'flush') {
      // 粒子按该手牌实际花色着色
      var frgb = flushRgb(cards);
      ring(ctx, cx, cy, 110, Math.min(1, p), frgb);
      ring(ctx, cx, cy, 140, Math.min(1, p + 0.22), frgb);
      burst(ctx, cx, cy, p, 20, 168, frgb);
    } else if (k === 'fullhouse') {
      ring(ctx, cx, cy, 112, Math.min(1, p), '214,168,255');
      ring(ctx, cx, cy, 138, Math.min(1, p + 0.2), '255,214,128');
      burst(ctx, cx, cy, p, 22, 172, '224,190,255');
    } else if (k === 'four') {
      // 粗冲击波环（震屏在 draw() 层做，见 fxShake）
      ctx.save();
      var sq = easeOut(Math.min(1, p * 1.2));
      ctx.globalAlpha = Math.max(0, 0.8 * (1 - p));
      ctx.strokeStyle = 'rgb(255,196,128)';
      ctx.lineWidth = 11 * (1 - p) + 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 40 + sq * Math.max(state.W, H) * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ring(ctx, cx, cy, 150, Math.min(1, p * 0.9), '255,150,110');
      ring(ctx, cx, cy, 108, Math.min(1, p * 0.9 + 0.25), '255,214,128');
      burst(ctx, cx, cy, p, 30, 210, '255,164,120');
      ctx.save();
      ctx.globalAlpha = Math.max(0, 0.42 * (1 - p * 1.8));
      ctx.fillStyle = '#ffcf9a';
      ctx.fillRect(0, 0, state.W, H);
      ctx.restore();
    } else if (k === 'straightflush') {
      var cols = ['255,140,120', '255,206,120', '255,246,180', '150,226,180', '150,206,255', '206,164,255'];
      for (var j = 0; j < 6; j++) {
        ring(ctx, cx, cy, 96 + j * 20, Math.min(1, p + j * 0.09), cols[j]);
      }
      burst(ctx, cx, cy, p, 34, 240, '255,240,200');
      // 满屏流光：线性渐变带从左到右扫过，400ms
      var sp = Math.min(1, p * 640 / 400);
      var band = Math.max(60, state.W * 0.22);
      var sx = -band + (state.W + band * 2) * sp;
      var grad = ctx.createLinearGradient(sx - band, 0, sx + band, 0);
      grad.addColorStop(0, 'rgba(255,244,196,0)');
      grad.addColorStop(0.5, 'rgba(255,244,196,0.5)');
      grad.addColorStop(1, 'rgba(255,244,196,0)');
      ctx.save();
      ctx.globalAlpha = 0.85 * (1 - sp * 0.35);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, state.W, H);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = Math.max(0, 0.46 * (1 - p * 2));
      ctx.fillStyle = '#fff1c9';
      ctx.fillRect(0, 0, state.W, H);
      ctx.restore();
    } else {
      ring(ctx, cx, cy, 120, Math.min(1, p), '255,216,140');
      burst(ctx, cx, cy, p, 18, 132, '255,216,140');
    }
    // 非单张牌型叠加横幅（label !== k 兜底未知牌型不显示原文）
    var label = kindLabel(k);
    if (k && k !== 'single' && label !== k) banner(ctx, label, p, L);
  }

  function fxOverlay(ctx, S, L, H) {
    if (S.fxDemoP !== undefined && S.fxDemoP !== null) {
      var dp = S.fxDemoP;
      if (S.fxDemoKind === 'identity') {
        identityFx(ctx, S, L, dp, S.fx && S.fx.identitySeat, S.fx && S.fx.identityRank);
        return;
      }
      if (S.fxDemoKind === 'lone') {
        loneRevealFx(ctx, S, L, H, dp, S.fx && S.fx.loneSeat);
        return;
      }
      if (S.fxDemoKind) {
        kindFx(ctx, S, L, H, S.fxDemoKind, dp, S.fx && S.fx.cards);
        return;
      }
      var dcy = Math.min(L.center.y, L.hand.y - 90);
      ring(ctx, state.W / 2, dcy, 150, dp);
      burst(ctx, state.W / 2, dcy, dp, 18, 132, '255,216,140');
      burst(ctx, state.W / 2, L.hand.y - 56, dp, 16, 160, '176,232,255');
      burst(ctx, state.W / 2, L.hand.y - 44, dp, 14, 130, '255,226,160');
      confetti(ctx, S, Math.min(1, dp * 1.2), H);
      return;
    }
    if (S.fxForce !== undefined && S.fxForce !== null) return;
    if (!S.fx) return;
    var now = Date.now();

    if (S.fx.playT0) {
      var pk = (now - S.fx.playT0) / 640;
      if (pk >= 0 && pk < 1) kindFx(ctx, S, L, H, S.fx.kind || 'single', pk, S.fx.cards);
    }
    if (S.fx.drawT0) {
      var p2 = (now - S.fx.drawT0) / 380;
      if (p2 >= 0 && p2 < 1) burst(ctx, state.W / 2, L.hand.y - 56, p2, 14, 116, '176,232,255');
    }
    if (S.fx.retT0) {
      var p3 = (now - S.fx.retT0) / 340;
      if (p3 >= 0 && p3 < 1) burst(ctx, state.W / 2, L.hand.y - 44, p3, 12, 96, '255,226,160');
    }
    if (S.fx.settleT0) {
      var p4 = (now - S.fx.settleT0) / 1000;
      if (p4 >= 0 && p4 < 1) confetti(ctx, S, p4, H);
    }
    if (S.fx.identityT0) {
      var p5 = (now - S.fx.identityT0) / 1000;
      if (p5 >= 0 && p5 < 1) identityFx(ctx, S, L, p5, S.fx.identitySeat, S.fx.identityRank);
    }
    if (S.fx.loneRevealT0) {
      var p6 = (now - S.fx.loneRevealT0) / 1600;
      if (p6 >= 0 && p6 < 1) loneRevealFx(ctx, S, L, H, p6, S.fx.loneSeat);
    }
  }

  function fxProgress(S, key, dur) {
    if (S.fxForce !== undefined && S.fxForce !== null) return S.fxForce;
    if (!S.fx || !S.fx[key]) return 1;
    var p = (Date.now() - S.fx[key]) / (dur || 260);
    return p <= 0 ? 0 : p >= 1 ? 1 : p;
  }













  function kindLabel(kind) {
    var m = {
      single: '单张', pair: '对子', trio: '三个', straight: '顺子',
      flush: '同花', fullhouse: '葫芦', four: '四条', straightflush: '同花顺'
    };
    return m[kind] || kind;
  }







  function pill(ctx, x, y, w, h, label, enabled, hits, act, tone, labelDx) {
    var r = h / 2;
    var fill = !enabled ? 'rgba(16,28,46,0.55)' : tone === 'blue' ? '#3b86d8' : '#e9b84d';
    var line = !enabled ? 'rgba(216,179,106,0.14)' : tone === 'blue' ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.5)';
    box(ctx, x, y, w, h, r, fill, line);
    if (enabled) {
      ctx.save();
      var lg = ctx.createLinearGradient(0, y, 0, y + h);
      lg.addColorStop(0, 'rgba(255,255,255,0.45)');
      lg.addColorStop(0.5, 'rgba(255,255,255,0.08)');
      lg.addColorStop(1, 'rgba(0,0,0,0.12)');
      rr(ctx, x, y, w, h, r);
      ctx.fillStyle = lg;
      ctx.fill();
      ctx.restore();
    }
    txt(ctx, label, x + w / 2 + (labelDx || 0), y + h / 2 + 1, 18,
      enabled ? (tone === 'blue' ? '#ffffff' : '#4a2f08') : 'rgba(242,234,216,0.4)', 'center', 600);
    if (enabled) hits.push({ x: x, y: y, w: w, h: h, act: act });
  }

  function clockChip(ctx, cx, cy, r, left, active) {
    var leftN = Math.max(0, left || 0);
    var warn = active && leftN <= 5;
    var ring = warn ? '#d8412f' : '#e9b84d';
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = active ? '#fffaf0' : 'rgba(255,255,255,0.34)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = ring;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - r * 0.46, cy - r * 0.94, r * 0.19, 0, Math.PI * 2);
    ctx.fillStyle = ring;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + r * 0.46, cy - r * 0.94, r * 0.19, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    txt(ctx, String(leftN), cx, cy + r * 0.3, Math.round(r * 0.92),
      warn ? '#d8412f' : '#5a3a12', 'center', 700);
  }

  function btn(ctx, x, y, w, h, label, enabled, hits, act, primary) {
    if (primary && enabled) {
      box(ctx, x, y, w, h, 10, C.gold, null);
      txt(ctx, label, x + w / 2, y + h / 2, 21, '#101f33', 'center', 600);
    } else {
      box(ctx, x, y, w, h, 10, enabled ? C.btn : 'rgba(16,28,46,0.6)',
        enabled ? C.panelLine : 'rgba(216,179,106,0.12)');
      txt(ctx, label, x + w / 2, y + h / 2, 21, enabled ? C.text : 'rgba(242,234,216,0.35)');
    }
    if (enabled) hits.push({ x: x, y: y, w: w, h: h, act: act });
  }

  // ---------- 进贡面板 ----------
  function cardTxt(c) {
    var r = c.r === 11 ? 'J' : c.r === 12 ? 'Q' : c.r === 13 ? 'K' : c.r === 14 ? 'A' : String(c.r);
    return SUIT[c.s] + r;
  }


  // ---------- 结算 ----------
  function overlay(ctx, H, w, h) {
    ctx.fillStyle = 'rgba(5,10,18,0.72)';
    ctx.fillRect(0, 0, state.W, H);
  }




































  // ---------- 新手引导 ----------
  var GUIDE_PAGES = [
    {
      t: '一、认牌与大小',
      lines: [
        '整副 52 张、四家各 13 张，没有大小王。',
        '点数 3 最大、4 最小：3 > 2 > A > K > … > 5 > 4。',
        '同点数比花色：♠ > ♥ > ♣ > ♦。',
        '♦4 是起手牌：每局第一手必须带 ♦4。'
      ]
    },
    {
      t: '二、牌型与出牌',
      lines: [
        '单张、对子、三个、顺子（≥5 张连续）、同花顺、葫芦。',
        '对子/三个比「其中较大那张」的点数与花色。',
        '顺子按最大张比；同花顺比顺子大。',
        '压不过就「不出」，四家都过则由上家重新起手。'
      ]
    },
    {
      t: '三、朋友与独食',
      lines: [
        '♠3 与 ♠A 同持 ＝ 独食，1 打 3，两家都赢你就算你输。',
        '不独食就按身份牌分两队：持 ♠3 与持 ♠A 的两人是朋友。',
        '名次：先出完 1、2、3、4，按名次计分并决定进贡。',
        '下一局：输家给赢家进贡（重贡 4/2，轻贡 2/1）。'
      ]
    }
  ];

  return {
    state, C, SEAT_NAMES, SEAT_POS, SUIT, RANK_TXT, SKINS, DEAL_ORDER, CONFETTI_COLORS, FLUSH_RGB, GUIDE_PAGES,
    banner, bg, box, btn, burst, cardTxt, clockChip, confetti, dealState, drawBack, drawCard, drawSpade, easeOut, flushRgb, fxOverlay, fxProgress, fxShake, identityFx, isRed, kindFx, kindLabel, layout, loneRevealFx, overlay, pill, rankText, ring, rr, txt
  };
};