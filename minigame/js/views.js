// 画布视图：把牌桌状态画到 canvas 上，同时产出可点击热区
(function () {
  var W = 750;
  var lastH = 0; // draw() 记录画布高，供 banner() 定位（其签名不含 H）
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

  function layout(H) {
    var landscape = (W / H) >= 1.2;
    if (landscape) {
      var handY = H - 92;
      var barTop = handY - 44 - 8;
      var midY = Math.round((36 + 48 + barTop) / 2);
      return {
        H: H,
        headerH: 56,
        landscape: true,
        table: { top: 56, bottom: H - 110 },
        seats: {
          north: { x: Math.round(W / 2) - 75, y: 36, w: 150, h: 48 },
          west: { x: 14, y: Math.round(H / 2) - 60, w: 130, h: 56 },
          east: { x: W - 14 - 130, y: Math.round(H / 2) - 60, w: 130, h: 56 },
          south: { x: 14, y: H - 82, w: 122, h: 66 }
        },
        center: { y: midY },
        hand: {
          y: H - 100,
          cardW: 96,
          cardH: 100,
          step: 46,
          x0: 148
        },
        actions: { y: H - 200, h: 56, right: true }
      };
    }
    var headerH = 96;
    var seatW = 176, seatH = 64;
    var rowY = headerH + 8;
    var handY = H - 268;
    return {
      H: H,
      headerH: headerH,
      landscape: false,
      table: { top: headerH, bottom: handY - 96 },
      seats: {
        north: { x: W / 2 - seatW / 2, y: rowY, w: seatW, h: seatH },
        west: { x: 22, y: rowY, w: seatW, h: seatH },
        east: { x: W - 22 - seatW, y: rowY, w: seatW, h: seatH },
        south: { x: 24, y: handY - 84, w: seatW, h: seatH }
      },
      center: { y: Math.round(H * 0.40) },
      hand: {
        y: handY,
        cardW: 64,
        cardH: 90,
        step: 52
      },
      actions: { y: H - 112, h: 74 }
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

  function drawBack(ctx, x, y, w, h) {
    box(ctx, x, y, w, h, Math.max(3, w * 0.1), '#2c5170', 'rgba(230,240,250,0.45)');
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#dce9f5';
    ctx.lineWidth = 1;
    for (var i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x + 2, y + h * i / 4);
      ctx.lineTo(x + w - 2, y + h * i / 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  function txt(ctx, s, x, y, size, color, align, weight) {
    ctx.font = (weight || 400) + ' ' + size + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = color || C.text;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  }

  function bg(ctx, H) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.bg1);
    g.addColorStop(0.45, C.felt);
    g.addColorStop(1, C.bg0);
    ctx.fillStyle = g;
    ctx.fillRect(-12, -12, W + 24, H + 24); // 外扩 12px：四条震屏 translate 时不露白边

    // 牌桌内框
    var landscape = (W / H) >= 1.2;
    var pad = 18;
    var handY0 = H - 100;
    var barTop0 = handY0 - 52;
    var inner = landscape
      ? { x: pad, y: 64, w: W - pad * 2, h: Math.max(110, barTop0 - 64 - 6) }
      : { x: 48, y: 150, w: W - 96, h: H - 514 };
    box(ctx, inner.x, inner.y, inner.w, inner.h, 26, null, 'rgba(216,179,106,0.16)');

    // 水印（放两侧留白，避免压住出牌区）
    ctx.save();
    ctx.globalAlpha = 0.07;
    txt(ctx, '♠', inner.x + inner.w * 0.16, inner.y + inner.h * 0.3, Math.min(W, H) * 0.16, '#ffffff');
    txt(ctx, '♠', inner.x + inner.w * 0.84, inner.y + inner.h * 0.74, Math.min(W, H) * 0.16, '#ffffff');
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
    var r = Math.max(4, w * 0.08);
    box(ctx, x, y, w, h, r, '#172943', 'rgba(216,179,106,0.35)');
    ctx.save();
    rr(ctx, x, y, w, h, r);
    ctx.clip();
    ctx.strokeStyle = 'rgba(216,179,106,0.28)';
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
      var x = (seed / 997) * (W - 40) + 20 + Math.sin(p * 5 + i) * 22;
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
  function banner(ctx, text, p) {
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
    var size = Math.max(30, Math.round(W * 0.058));
    var cy = Math.round((lastH || 640) * 0.30) + dy;
    ctx.save();
    ctx.translate(W / 2, cy);
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

  // 四条震屏：±6px 随机偏移，300ms 线性衰减；返回 null 表示不震
  function fxShake(S) {
    var el;
    if (S.fxDemoP !== undefined && S.fxDemoP !== null) {
      if (S.fxDemoKind !== 'four') return null;
      el = S.fxDemoP * 640;
    } else {
      if (!S.fx || S.fx.kind !== 'four' || !S.fx.playT0) return null;
      el = Date.now() - S.fx.playT0;
    }
    if (el < 0 || el >= 300) return null;
    var amp = 6 * (1 - el / 300);
    return { x: (Math.random() * 2 - 1) * amp, y: (Math.random() * 2 - 1) * amp };
  }

  // 牌型专属特效：环数、色带、闪光按牌型递进；非单张叠加横幅；cards 为该手牌数组（供同花着色）
  function kindFx(ctx, S, L, H, k, p, cards) {
    var cx = W / 2;
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
      ctx.arc(cx, cy, 40 + sq * Math.max(W, H) * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ring(ctx, cx, cy, 150, Math.min(1, p * 0.9), '255,150,110');
      ring(ctx, cx, cy, 108, Math.min(1, p * 0.9 + 0.25), '255,214,128');
      burst(ctx, cx, cy, p, 30, 210, '255,164,120');
      ctx.save();
      ctx.globalAlpha = Math.max(0, 0.42 * (1 - p * 1.8));
      ctx.fillStyle = '#ffcf9a';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else if (k === 'straightflush') {
      var cols = ['255,140,120', '255,206,120', '255,246,180', '150,226,180', '150,206,255', '206,164,255'];
      for (var j = 0; j < 6; j++) {
        ring(ctx, cx, cy, 96 + j * 20, Math.min(1, p + j * 0.09), cols[j]);
      }
      burst(ctx, cx, cy, p, 34, 240, '255,240,200');
      // 满屏流光：线性渐变带从左到右扫过，400ms
      var sp = Math.min(1, p * 640 / 400);
      var band = Math.max(60, W * 0.22);
      var sx = -band + (W + band * 2) * sp;
      var grad = ctx.createLinearGradient(sx - band, 0, sx + band, 0);
      grad.addColorStop(0, 'rgba(255,244,196,0)');
      grad.addColorStop(0.5, 'rgba(255,244,196,0.5)');
      grad.addColorStop(1, 'rgba(255,244,196,0)');
      ctx.save();
      ctx.globalAlpha = 0.85 * (1 - sp * 0.35);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = Math.max(0, 0.46 * (1 - p * 2));
      ctx.fillStyle = '#fff1c9';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else {
      ring(ctx, cx, cy, 120, Math.min(1, p), '255,216,140');
      burst(ctx, cx, cy, p, 18, 132, '255,216,140');
    }
    // 非单张牌型叠加横幅（label !== k 兜底未知牌型不显示原文）
    var label = kindLabel(k);
    if (k && k !== 'single' && label !== k) banner(ctx, label, p);
  }

  function fxOverlay(ctx, S, L, H) {
    if (S.fxDemoP !== undefined && S.fxDemoP !== null) {
      var dp = S.fxDemoP;
      if (S.fxDemoKind) {
        kindFx(ctx, S, L, H, S.fxDemoKind, dp, S.fx && S.fx.cards);
        return;
      }
      var dcy = Math.min(L.center.y, L.hand.y - 90);
      ring(ctx, W / 2, dcy, 150, dp);
      burst(ctx, W / 2, dcy, dp, 18, 132, '255,216,140');
      burst(ctx, W / 2, L.hand.y - 56, dp, 16, 160, '176,232,255');
      burst(ctx, W / 2, L.hand.y - 44, dp, 14, 130, '255,226,160');
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
      if (p2 >= 0 && p2 < 1) burst(ctx, W / 2, L.hand.y - 56, p2, 14, 116, '176,232,255');
    }
    if (S.fx.retT0) {
      var p3 = (now - S.fx.retT0) / 340;
      if (p3 >= 0 && p3 < 1) burst(ctx, W / 2, L.hand.y - 44, p3, 12, 96, '255,226,160');
    }
    if (S.fx.settleT0) {
      var p4 = (now - S.fx.settleT0) / 1000;
      if (p4 >= 0 && p4 < 1) confetti(ctx, S, p4, H);
    }
  }

  function fxProgress(S, key, dur) {
    if (S.fxForce !== undefined && S.fxForce !== null) return S.fxForce;
    if (!S.fx || !S.fx[key]) return 1;
    var p = (Date.now() - S.fx[key]) / (dur || 260);
    return p <= 0 ? 0 : p >= 1 ? 1 : p;
  }

  // ---------- 页头 ----------
  function header(ctx, S, L, hits) {
    txt(ctx, '十三张·独食', 24, 44, 26, C.gold, 'left', 600);
    var online = S.mode === 'online';
    txt(ctx, online ? ('联机' + (S.room ? ' · 房间 ' + S.room : ' · 未连接')) : '单机 · 三家 AI',
      24, 74, 15, online ? C.gold : C.dim, 'left', 400);
    hits.push({ x: 16, y: 54, w: 240, h: 36, act: 'mode' });

    var y = 26, h = 44, gap = 8, rad = 22, fs = 15;
    var x = W - 24;
    // 重开
    x -= 78;
    box(ctx, x, y, 78, h, rad, C.btn, C.panelLine);
    txt(ctx, '重开', x + 39, y + h / 2, fs, C.text);
    hits.push({ x: x, y: y, w: 78, h: h, act: 'newMatch' });

    // 对手强度
    x -= gap + 86;
    box(ctx, x, y, 86, h, rad, C.btn, C.panelLine);
    txt(ctx, ['新手', '普通', '高手'][S.level] || '普通', x + 43, y + h / 2, fs, C.text);
    hits.push({ x: x, y: y, w: 86, h: h, act: 'level' });

    // 进贡档位
    x -= gap + 86;
    box(ctx, x, y, 86, h, rad, C.btn, C.panelLine);
    txt(ctx, S.cfg.tributeTier === 'heavy' ? '重贡' : '轻贡', x + 43, y + h / 2, fs, C.text);
    hits.push({ x: x, y: y, w: 86, h: h, act: 'tier' });

    // 场次
    x -= gap + 78;
    box(ctx, x, y, 78, h, rad, C.btn, C.panelLine);
    txt(ctx, S.rounds + '局', x + 39, y + h / 2, fs, C.text);
    hits.push({ x: x, y: y, w: 78, h: h, act: 'round' });

    // 音效开关
    x -= gap + 78;
    var on = S.audioOn !== false;
    box(ctx, x, y, 78, h, rad, on ? C.btn : 'rgba(16,28,46,0.55)',
      on ? C.panelLine : 'rgba(216,179,106,0.12)');
    txt(ctx, on ? '音效' : '静音', x + 39, y + h / 2, fs, on ? C.text : C.dim);
    hits.push({ x: x, y: y, w: 78, h: h, act: 'audio' });

    // 进贡流程测试入口
    x -= gap + 78;
    box(ctx, x, y, 78, h, rad, 'rgba(216,179,106,0.16)', C.goldDim);
    txt(ctx, '测进贡', x + 39, y + h / 2, fs, C.gold);
    hits.push({ x: x, y: y, w: 78, h: h, act: 'testTribute' });
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
    var lone = rc.indexOf(3) >= 0 && rc.indexOf(14) >= 0;

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
    txt(ctx, pre, lx, ly, subFs, C.dim, 'left');
    if (g) {
      ctx.font = '400 ' + subFs + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
      var off = ctx.measureText(pre).width;
      txt(ctx, (pts > 0 ? '+' : '') + pts + '分', lx + off, ly, subFs,
        pts > 0 ? C.gold : pts < 0 ? '#d99a98' : C.dim, 'left', 600);
    }

    // 独食者：「独食」字常驻牌右上角
    if (lone) {
      txt(ctx, '独食', rect.x + rect.w - 8, rect.y + 12, 11, '#e8b0ae', 'right', 700);
    }

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
      txt(ctx, '♠' + rankText(r), cx, cy + 1, 11, C.gold, 'center', 600);
    });
  }

  function seats(ctx, S, L, hits) {
    for (var p = 0; p < 4; p++) {
      if (p === 0 && S.phase === 'tribute') continue; // 进贡面板会盖住南家座位
      var rect = L.seats[SEAT_POS[p]];
      seatPlate(ctx, S, p, rect, hits);
      var pickable = S.tribute && S.tribute.stage === 'draw' && S.tribute.humanIsWinner &&
        S.tribute.plan.losers.indexOf(p) >= 0;
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
          var isTurn = TR.turnW === p;
          var canPick = TR.stage === 'draw' && (TR.canDraw || []).indexOf(p) >= 0;
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
              var bx1 = rect.x + rect.w / 2;
              box(ctx, bx1 - 34, rect.y - 32, 68, 22, 11, 'rgba(233,184,77,0.95)', null);
              txt(ctx, '点我抽牌', bx1, rect.y - 21, 12, '#3b2a08', 'center', 600);
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
        var cx0 = rect.x + rect.w / 2;
        var cy0 = posName === 'north' ? rect.y + rect.h + 22 : rect.y - 24;
        if (posName === 'south') { cx0 = rect.x + rect.w + 26; cy0 = rect.y + rect.h / 2; }
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
      txt(ctx, '点右上「重开」开始', W / 2, cy, 20, C.dim);
      return;
    }

    var ds = dealState(S);
    if (ds && !ds.done) { dealTable(ctx, S, L, ds); return; }

    var plays = g.trickPlays || [];
    if (!plays.length) {
      txt(ctx, S.phase === 'play' && g.turn >= 0 ? SEAT_NAMES[g.turn] + ' 起手' : '', W / 2, cy, 19, C.dim);
      return;
    }

    var newest = plays[plays.length - 1];
    var hist = plays.slice(0, -1).slice(-4);

    // 最新一手：放大居中
    var n = newest.cards.length;
    var gap = n >= 8 ? 6 : 12;
    var maxW = L.landscape ? Math.min(W - 220, 480) : Math.min(W - 280, 430);
    var chCap = L.landscape
      ? Math.max(56, (L.hand.y - 50 - 44 - 6) - (L.seats.north.y + L.seats.north.h) - 12)
      : 999;
    var cw = Math.floor((maxW - (n - 1) * gap) / n);
    cw = Math.max(28, Math.min(cw, Math.floor(chCap / 1.38), n <= 2 ? 96 : n <= 5 ? 70 : 48));
    var ch = Math.round(cw * 1.38);
    var blockW = n * cw + (n - 1) * gap;
    var cxB = W / 2;
    var x0 = cxB - blockW / 2;
    var yTop = Math.max(cy - ch / 2, L.seats.north.y + L.seats.north.h + 26);
    yTop = Math.min(yTop, L.hand.y - ch - 74);

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
      W / 2, yTop - 16, 13, C.gold, 'center', 600);

    newest.cards.forEach(function (c, i) {
      var mark = c.s === 3 && (c.r === 3 || c.r === 14);
      drawCard(ctx, x0 + i * (cw + gap), yTop, cw, ch, c, { mark: mark });
    });

    // 本轮之前的出牌：缩到最新一手右侧横排，保证一轮没结束前都看得到
    if (hist.length) {
      var hw = 26, hh = 34, hgap = 2;
      var hx = x0 + blockW + 20;
      var hy = yTop + 10;
      var maxX = W - 148;
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
    var dx = W / 2 - dw / 2, dy = cy - dh / 2;

    var left = ds.left;
    for (var i = 0; i < Math.min(4, left); i++) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      drawBack(ctx, dx + i * 3, dy - i * 3, dw, dh);
      ctx.restore();
    }
    txt(ctx, '发牌中 · 点击跳过', W / 2, cy + dh / 2 + 34, 16, C.dim);

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

  function kindLabel(kind) {
    var m = {
      single: '单张', pair: '对子', trio: '三个', straight: '顺子',
      flush: '同花', fullhouse: '葫芦', four: '四条', straightflush: '同花顺'
    };
    return m[kind] || kind;
  }

  // ---------- 手牌 ----------
  function hand(ctx, S, L, hits) {
    var g = S.game;
    var mine = g ? g.players[0].hand : [];
    var ds = dealState(S);
    var n = ds && !ds.done ? Math.min(mine.length, ds.arrived[0]) : mine.length;
    // 横屏为左下南家座位牌预留 150px；竖屏南家已移至手牌区左上，手牌整行居中
    var reserve = L.landscape ? 320 : 48;
    var avail = W - reserve - L.hand.cardW;
    var step = n > 1 ? Math.min(L.hand.step, Math.max(26, avail / (n - 1))) : L.hand.step;
    var totalW = (n - 1) * step + L.hand.cardW;
    var hx = Math.max(L.landscape ? 150 : 24, Math.round((W - totalW) / 2));

    mine.slice(0, n).forEach(function (c, i) {
      var sel = S.selected.some(function (s) { return s.r === c.r && s.s === c.s; });
      var x = hx + i * step;
      var y = L.hand.y - (sel ? 22 : 0);
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
    var bx = L.actions.right ? Math.round(W - 24 - total) : Math.round(W / 2 - total / 2);

    pill(ctx, bx, barY, wHint, barH, '提示', can, hits, 'hint', 'gold');
    bx += wHint + gapB;

    pill(ctx, bx, barY, wPass, barH, '不出', can && g && !!g.combo, hits, 'pass', 'gold');
    bx += wPass + gapB;

    // 倒计时嵌在「出牌」按钮左侧：复用 clockChip 画法（半径 14），剩余秒数在环心
    pill(ctx, bx, barY, wPlay, barH, '出牌', can, hits, 'play', 'blue', 20);
    clockChip(ctx, bx + 26, barY + barH / 2, 14, S.timer.left, S.phase === 'play');
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

  function tribute(ctx, S, L, hits) {
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
    box(ctx, barX, barY, barW, barH, 14, 'rgba(10,20,34,0.96)', 'rgba(216,179,106,0.4)');
    ctx.restore();

    var cnt = (T.pull && (T.pull.total || T.pull.count)) || T.need || (T.plan && T.plan.count) || 0;
    var retTotal = (T.ret && T.ret.total) || (T.retQueue || []).length || 0;
    var retIdx = (T.ret && typeof T.ret.idx === 'number') ? T.ret.idx : (T.retIdx || 0);
    var retFrom = (T.ret && typeof T.ret.curFrom === 'number') ? T.ret.curFrom
      : ((T.retQueue && T.retQueue[T.retIdx]) ? T.retQueue[T.retIdx].from : -1);
    var prog = '进贡完成';
    if (T.stage === 'draw') prog = T.humanIsWinner ? '点金框的对手抽牌' : '等待对手抽牌';
    else if (T.stage === 'pull') prog = '点牌背抽牌（' + ((T.pull && T.pull.done) || 0) + '/' + cnt + '）';
    else if (T.stage === 'return') {
      prog = '还贡 ' + Math.min(retIdx + 1, retTotal) + '/' + retTotal + ' → 还给 ' + (retFrom >= 0 ? SEAT_NAMES[retFrom] : '')
        + ((S.selected || []).length ? ' · 已选 ' + S.selected.length + ' 张' : '');
    }

    txt(ctx, '第 ' + S.round + ' 局 · 进贡', barX + 16, barY + barH / 2, 15, C.gold, 'left', 600);
    txt(ctx, prog, barX + barW / 2 - 40, barY + barH / 2, 15, C.text, 'center', 600);

    // 还贡按钮（做出牌那种胶囊）：勾选完点这里才提交
    if (T.stage === 'return') {
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
      txt(ctx, lastLog.text, W / 2, barY - 15, 12.5,
        lastLog.kind === 'warn' ? '#f3b7b2' : C.dim, 'center');
    }

    // 摊牌：被抽者整手牌背面朝上摊开（独食三家同时摊三排），点任意一张抽走
    if (T.stage === 'pull' && T.pull && T.pull.rows) {
      var rows = T.pull.rows;
      var nMax = 1;
      rows.forEach(function (r) { if (r.n > nMax) nMax = r.n; });
      var gp2 = 6;
      var maxPw = rows.length >= 3 ? 38 : (rows.length === 2 ? 42 : 46);
      var fitPw = Math.floor((Math.min(W - 120, 680) - (nMax - 1) * gp2) / nMax);
      var pw = Math.max(16, Math.min(maxPw, fitPw));
      var phh = Math.round(pw * 1.4);
      var rowGap = rows.length >= 3 ? 12 : 22;
      var blockH = rows.length * phh + (rows.length - 1) * rowGap;
      var top = L.center.y - blockH / 2 - 2;

      // 配额进度/置灰仅用于独食抽牌方向（winners.length===1，多败方行，got 按每家计）；
      // 被抽方向只有一排且 drawnFrom 是跨胜方合计，cap 无意义，保持"N 张"不置灰；
      // 2v2 的 cap 为 null（无上限），同样保持现状
      var loneDraw = !!(T.plan && T.plan.winners && T.plan.winners.length === 1);
      rows.forEach(function (row, ri) {
        var n = Math.max(1, row.n);
        var totalW = n * pw + (n - 1) * gp2;
        var sx = Math.max(104, (W - totalW) / 2);
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
      txt(ctx, doneTxt, W / 2, top + blockH + 18, 12.5, C.dim, 'center');
    }
  }
  // ---------- 结算 ----------
  function overlay(ctx, H, w, h) {
    ctx.fillStyle = 'rgba(5,10,18,0.72)';
    ctx.fillRect(0, 0, W, H);
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
    overlay(ctx, H, W, H);

    var pw = 660, ph = 520;
    var px = (W - pw) / 2, py = (H - ph) / 2 - 40;
    box(ctx, px, py, pw, ph, 16, C.panel, C.panelLine);

    var title = res.camp.mode === 'lone' ? '本局：独食 1 打 3' : '本局：2 打 2';
    txt(ctx, title, W / 2, py + 52, 26, C.gold, 'center', 600);
    var sub = res.camp.mode === 'lone'
      ? '独食者 ' + SEAT_NAMES[res.camp.lone] + ' 拿第 ' + (res.ranks.indexOf(res.camp.lone) + 1) + ' 名'
      : '胜方名次 ' + res.winRanks.join('、');
    txt(ctx, sub, W / 2, py + 86, 16, C.dim);

    var cols = [px + 40, px + 200, px + 330, px + 470, px + 590];
    var hy = py + 128;
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
    var bw = 240, bh = 58;
    box(ctx, W / 2 - bw / 2, py + ph - 92, bw, bh, 10, C.gold, null);
    txt(ctx, isLast ? '看总成绩' : '下一局', W / 2, py + ph - 63, 21, '#101f33', 'center', 600);
    hits.push({ x: W / 2 - bw / 2, y: py + ph - 92, w: bw, h: bh, act: 'next' });
    ctx.restore();
  }

  // ---------- 全场总结 ----------
  // ---------- 开始界面 ----------
  function menu(ctx, S, L, hits) {
    var H = L.H;
    var land = L.landscape;

    // 横屏按 750 高设计，主内容宽度用屏宽的 55%，避免超大屏上字太小
    var cw = land ? Math.max(700, Math.min(1040, W * 0.6)) : Math.min(640, W - 56);
    var cx = (W - cw) / 2;

    var ty = land ? 72 : 150;
    txt(ctx, '十三张 · 独食', W / 2, ty, land ? 64 : 46, C.gold, 'center', 700);
    txt(ctx, '横县找朋友 · ♠3 与 ♠A 同持即独食', W / 2, ty + (land ? 54 : 48), land ? 22 : 16, C.dim);

    var lines = [
      '♦4 起手，第一手必须带 ♦4',
      '点数 3 最大、4 最小；花色 ♠ > ♥ > ♣ > ♦',
      '对子比「一对里较大那张」的花色',
      '♠3 / ♠A 打出时在座位旁亮牌，两张都亮＝独食 1 打 3',
      '第 2 局起进贡：胜方从败方抽牌，抽到身份牌亮出归还重抽'
    ];
    var lh = land ? 36 : 28;
    var ry = ty + (land ? 86 : 84);
    var rh = lh * lines.length + (land ? 52 : 54);
    box(ctx, cx, ry, cw, rh, 14, 'rgba(10,20,34,0.74)', C.panelLine);
    txt(ctx, '玩法', cx + (land ? 32 : 24), ry + (land ? 26 : 26), land ? 19 : 15, C.gold, 'left', 600);
    lines.forEach(function (l, i) {
      txt(ctx, '· ' + l, cx + (land ? 32 : 24),
        ry + (land ? 58 : 56) + i * lh, land ? 23 : 14, C.text, 'left');
    });

    var sy = ry + rh + (land ? 20 : 22);
    var chips = [
      { act: 'cfgRounds', label: '场次', value: S.rounds + ' 局' },
      { act: 'cfgLevel', label: '对手', value: ['新手', '普通', '高手'][S.level] || '普通' },
      { act: 'cfgTribute', label: '进贡', value: !S.cfg.tributeEnabled ? '关闭' : (S.cfg.tributeTier === 'heavy' ? '重贡 4/2' : '轻贡 2/1') }
    ];
    var gapC = 12;
    var chipW = (cw - gapC * 2) / 3;
    var chipH = land ? 80 : 66;
    chips.forEach(function (c, i) {
      var x = cx + i * (chipW + gapC);
      box(ctx, x, sy, chipW, chipH, 12, 'rgba(10,20,34,0.82)', C.panelLine);
      txt(ctx, c.label, x + chipW / 2, sy + chipH * 0.32, land ? 17 : 13, C.dim);
      txt(ctx, c.value, x + chipW / 2, sy + chipH * 0.68, land ? 26 : 17, C.text, 'center', 600);
      hits.push({ x: x, y: sy, w: chipW, h: chipH, act: c.act });
    });

    var by = sy + chipH + (land ? 22 : 24);
    var bw = land ? Math.min(cw * 0.56, 620) : Math.min(cw, 420);
    var bh = land ? 86 : 74;
    box(ctx, (W - bw) / 2, by, bw, bh, 14, C.gold, null);
    txt(ctx, '开始游戏', W / 2, by + bh / 2 + 1, land ? 34 : 24, '#101f33', 'center', 700);
    hits.push({ x: (W - bw) / 2, y: by, w: bw, h: bh, act: 'startGame' });

    var ny = by + bh + (land ? 16 : 14);
    var nh = land ? 64 : 58;
    box(ctx, (W - bw) / 2, ny, bw, nh, 12, C.btn, C.panelLine);
    txt(ctx, '联机对战', W / 2, ny + nh / 2 + 1, land ? 24 : 19, C.text, 'center', 600);
    hits.push({ x: (W - bw) / 2, y: ny, w: bw, h: nh, act: 'netOpen' });

    txt(ctx, '第 1 局不进贡 · 出牌逆时针 · 纯积分休闲娱乐，不涉及任何财物', W / 2, Math.min(ny + nh + (land ? 34 : 36), H - 18), land ? 17 : 13, C.dim);
  }

  function summary(ctx, S, L, hits) {
    var H = L.H;
    overlay(ctx, H, W, H);
    var pw = 600, ph = 460;
    var px = (W - pw) / 2, py = (H - ph) / 2;
    box(ctx, px, py, pw, ph, 16, C.panel, C.panelLine);

    txt(ctx, '全场结束 · ' + S.rounds + ' 局', W / 2, py + 56, 26, C.gold, 'center', 600);
    S.scores.forEach(function (s, i) {
      var y = py + 120 + i * 46;
      txt(ctx, SEAT_NAMES[i], px + 90, y, 19, C.text, 'left');
      txt(ctx, (s > 0 ? '+' : '') + s, px + pw - 90, y, 19, s > 0 ? C.gold : s < 0 ? '#d99a98' : C.dim, 'right');
    });
    var bw = 260, bh = 58;
    box(ctx, W / 2 - bw / 2, py + ph - 88, bw, bh, 10, C.gold, null);
    txt(ctx, '再来一场', W / 2, py + ph - 59, 20, '#101f33', 'center', 600);
    hits.push({ x: W / 2 - bw / 2, y: py + ph - 88, w: bw, h: bh, act: 'newMatch' });

    box(ctx, W / 2 - bw / 2, py + ph - 22, bw, 42, 10, C.btn, C.panelLine);
    txt(ctx, '回到开始界面', W / 2, py + ph - 1, 16, C.text, 'center');
    hits.push({ x: W / 2 - bw / 2, y: py + ph - 22, w: bw, h: 42, act: 'toMenu' });
  }

  function toast(ctx, S, L) {
    var w = 420, h = 54;
    box(ctx, W / 2 - w / 2, L.H - 400, w, h, 10, 'rgba(10,20,34,0.9)', C.panelLine);
    txt(ctx, S.toast, W / 2, L.H - 373, 17, C.text);
  }

  // ---------- 联机：大厅 / 房号键盘 / 房间等待 ----------
  function lobbyPanel(ctx, S, L, hits) {
    var H = L.H;
    overlay(ctx, H, W, H);
    var pw = 660, ph = S.lobby.kind === 'keypad' ? 660 : S.lobby.kind === 'config' ? 340 : 500;
    var px = (W - pw) / 2, py = (H - ph) / 2 - ((W / H) >= 1.2 ? 20 : 0);
    if (py < 8) py = 8;
    box(ctx, px, py, pw, ph, 16, C.panel, C.panelLine);

    if (S.lobby.kind === 'entry') {
      txt(ctx, '联机对战', W / 2, py + 56, 28, C.gold, 'center', 600);
      txt(ctx, '同一台路由器内可直连；跨网需要 wss 域名', W / 2, py + 88, 14, C.dim);
      txt(ctx, '服务器 ' + (S.lobby.url || ''), W / 2, py + 112, 13, C.dim);

      var by = py + 168;
      box(ctx, px + 40, by, pw - 80, 78, 12, C.gold, null);
      txt(ctx, '创建房间', W / 2, by + 41, 24, '#101f33', 'center', 600);
      hits.push({ x: px + 40, y: by, w: pw - 80, h: 78, act: 'netConfig' });

      by += 96;
      box(ctx, px + 40, by, pw - 80, 78, 12, C.btn, C.panelLine);
      txt(ctx, '加入房间', W / 2, by + 41, 22, C.text, 'center', 600);
      hits.push({ x: px + 40, y: by, w: pw - 80, h: 78, act: 'netKeypad' });

      by += 104;
      txt(ctx, S.lobby.err || S.netStatus || '', W / 2, by, 15,
        S.lobby.err ? '#e8b0ae' : C.dim);

      box(ctx, px + 150, py + ph - 92, pw - 300, 58, 10, C.btn, C.panelLine);
      txt(ctx, '返回单机', W / 2, py + ph - 63, 18, C.text, 'center');
      hits.push({ x: px + 150, y: py + ph - 92, w: pw - 300, h: 58, act: 'netBack' });
      return;
    }

    if (S.lobby.kind === 'config') {
      var RC = S.roomCfg || {};
      txt(ctx, '创建房间 · 房间设置', W / 2, py + 34, 22, C.gold, 'center', 600);

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

      if (S.lobby.err) txt(ctx, S.lobby.err, W / 2, py + 258, 12, '#e8b0ae', 'center');
      else txt(ctx, '局数与规则由房主设定 · 纯积分娱乐，无充值无兑换', W / 2, py + 258, 12, C.dim, 'center');

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
    txt(ctx, '输入房间号', W / 2, py + 44, 24, C.gold, 'center', 600);
    var code = S.lobby.code || '';
    var digits = (code + '____').slice(0, 4).split('');
    var cw = 64, gapd = 14;
    var totalW = 4 * cw + 3 * gapd;
    var cx0 = W / 2 - totalW / 2;
    digits.forEach(function (d, i) {
      var x = cx0 + i * (cw + gapd);
      box(ctx, x, py + 70, cw, 68, 10, 'rgba(10,20,34,0.7)', 'rgba(216,179,106,0.3)');
      txt(ctx, d === '_' ? '' : d, x + cw / 2, py + 104, 26, C.text);
    });

    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '退', '0', '进'];
    var kw = 148, kh = 66, kgx = 20, kgy = 10;
    var kx0 = W / 2 - (3 * kw + 2 * kgx) / 2;
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
    txt(ctx, '取消', W / 2, py + ph - 39, 17, C.text, 'center');
    hits.push({ x: kx0, y: py + ph - 62, w: 3 * kw + 2 * kgx, h: 46, act: 'netCancel' });
  }

  function roomPanel(ctx, S, L, hits) {
    var H = L.H;
    overlay(ctx, H, W, H);
    var pw = 660, ph = 660;
    var px = (W - pw) / 2, py = (H - ph) / 2;
    box(ctx, px, py, pw, ph, 16, C.panel, C.panelLine);

    txt(ctx, '房间号', W / 2, py + 46, 16, C.dim, 'center');
    txt(ctx, String(S.room || ''), W / 2, py + 96, 44, C.gold, 'center', 600);
    txt(ctx, '把房号发给朋友，或用链接 ?room=房号 进入', W / 2, py + 132, 14, C.dim);

    var RC2 = S.roomCfg || {};
    var tierTxt = { heavy: '重贡 4/2', light: '轻贡 2/1', off: '不进贡' };
    var hintTxt = { none: '不提示', reveal: '出牌后提示', always: '常显' };
    txt(ctx, (S.rounds || 8) + ' 局 · ' + (tierTxt[RC2.tributeTier] || '重贡') +
      ' · 每步 ' + (RC2.turnSeconds || 20) + ' 秒 · 队友' + (hintTxt[RC2.teamHint] || '不提示'),
      W / 2, py + 154, 13, C.gold, 'center');

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
    var y2 = py + ph - 168;
    if (S.isHost) {
      box(ctx, W / 2 - bw / 2, y2, bw, bh, 10, C.gold, null);
      txt(ctx, '开始（空位补机器人）', W / 2, y2 + 33, 18, '#101f33', 'center', 600);
      hits.push({ x: W / 2 - bw / 2, y: y2, w: bw, h: bh, act: 'netStart' });
    } else {
      box(ctx, W / 2 - bw / 2, y2, bw, bh, 10, C.btn, C.panelLine);
      txt(ctx, S.myReady ? '取消准备' : '准备', W / 2, y2 + 33, 19, C.text, 'center', 600);
      hits.push({ x: W / 2 - bw / 2, y: y2, w: bw, h: bh, act: 'netReady' });
    }

    box(ctx, W / 2 - 110, y2 + 78, 220, 52, 10, C.btn, C.panelLine);
    txt(ctx, '离开房间', W / 2, y2 + 78 + 27, 17, C.text, 'center');
    hits.push({ x: W / 2 - 110, y: y2 + 78, w: 220, h: 52, act: 'netLeave' });
  }

  function draw(ctx, S, H, wW) {
    if (wW) W = wW;
    lastH = H;
    var L = layout(H);
    var hits = [];
    // 四条震屏：整层 translate（±6px，300ms 衰减），不震时为恒等变换
    var shk = fxShake(S);
    ctx.save();
    if (shk) ctx.translate(shk.x, shk.y);
    bg(ctx, H);
    if (S.phase === 'menu' || (S.lobby && !S.game)) {
      menu(ctx, S, L, hits);
      if (S.lobby) lobbyPanel(ctx, S, L, hits);
      if (S.waitRoom) roomPanel(ctx, S, L, hits);
      if (S.toast) toast(ctx, S, L);
      ctx.restore();
      return hits;
    }
    header(ctx, S, L, hits);
    seats(ctx, S, L, hits);
    center(ctx, S, L, hits);
    if (!S.lobby && !S.waitRoom) {
      hand(ctx, S, L, hits);
      actions(ctx, S, L, hits);
    }
    if (S.tribute) tribute(ctx, S, L, hits);
    if (S.phase === 'settle') settle(ctx, S, L, hits);
    fxOverlay(ctx, S, L, H);
    if (S.summary) summary(ctx, S, L, hits);
    if (S.lobby) lobbyPanel(ctx, S, L, hits);
    if (S.waitRoom) roomPanel(ctx, S, L, hits);
    if (S.toast) toast(ctx, S, L);
    ctx.restore();
    return hits;
  }

  var exp = { draw: draw, layout: layout, C: C, SEAT_NAMES: SEAT_NAMES };
  if (typeof module === 'object' && module.exports) module.exports = exp;
  else (window.VIEWS = exp);
})();
