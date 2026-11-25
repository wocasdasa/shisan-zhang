// 画布视图：把牌桌状态画到 canvas 上，同时产出可点击热区
// 具体绘制拆在 views/base.js（原语与特效）、views/table.js（牌桌）、views/panels.js（弹层）
(function () {
  var B = require('./views/base.js')();
  var T = require('./views/table.js')(B);
  var P = require('./views/panels.js')(B);

  // 同名接住三层导出，draw() 里的调用名保持不变
  var C = B.C; // 导出用
  var SEAT_NAMES = B.SEAT_NAMES; // 导出用
  var actions = T.actions;
  var askPanel = P.askPanel;
  var bg = B.bg;
  var box = B.box;
  var center = T.center;
  var chatBubbles = P.chatBubbles;
  var chatEntry = T.chatEntry;
  var chatPanel = P.chatPanel;
  var fxOverlay = B.fxOverlay;
  var fxShake = B.fxShake;
  var guidePanel = P.guidePanel;
  var hand = T.hand;
  var header = T.header;
  var layout = B.layout;
  var lobbyPanel = P.lobbyPanel;
  var menu = P.menu;
  var pausePanel = P.pausePanel;
  var recordStrip = P.recordStrip;
  var replayPanel = P.replayPanel;
  var roomPanel = P.roomPanel;
  var seats = T.seats;
  var settle = P.settle;
  var state = B.state;
  var statsPanel = P.statsPanel;
  var summary = P.summary;
  var testPanel = P.testPanel;
  var toast = P.toast;
  var toolsDrawer = P.toolsDrawer;
  var tribute = P.tribute;
  var txt = B.txt;

  function draw(ctx, S, H, wW) {
    if (wW) state.W = wW;
    state.SKIN = S.skin || 0;
    state.lastH = H;
    var L = layout(H);
    var hits = [];
    // 四条震屏：整层 translate（±6px，300ms 衰减），不震时为恒等变换
    var shk = fxShake(S);
    ctx.save();
    if (shk) ctx.translate(shk.x, shk.y);
    bg(ctx, L);
    if (S.phase === 'menu' || (S.lobby && !S.game)) {
      menu(ctx, S, L, hits);
      if (S.lobby) lobbyPanel(ctx, S, L, hits);
      if (S.waitRoom) roomPanel(ctx, S, L, hits);
      if (S.guideOpen) guidePanel(ctx, S, L, hits);
      if (S.ask) askPanel(ctx, S, L, hits);
      if (S.toast) toast(ctx, S, L);
      ctx.restore();
      return hits;
    }
    header(ctx, S, L, hits);
    seats(ctx, S, L, hits);
    center(ctx, S, L, hits);
    if (!S.lobby && !S.waitRoom) {
      hand(ctx, S, L, hits);
      recordStrip(ctx, S, L);
      actions(ctx, S, L, hits);
      chatEntry(ctx, S, L, hits);
      chatBubbles(ctx, S, L);
    }
    if (S.tribute) tribute(ctx, S, L, hits);
    // 掉线重连条：常驻在操作带上方，不挡手牌
    if (S.reconnecting) {
      var rw = 320, rh = 34, rx = (state.W - rw) / 2;
      var ry = (L.actions ? L.actions.y : L.hand.y - 80) - 44;
      box(ctx, rx, ry, rw, rh, 17, 'rgba(140,47,42,0.92)', 'rgba(255,210,180,0.6)');
      txt(ctx, '连接断开，正在重连 ' + (S.reconnectTries || 1) + '/8 …',
        state.W / 2, ry + rh / 2, 14, '#ffe9dd', 'center', 600);
    }
    if (S.phase === 'settle') settle(ctx, S, L, hits);
    fxOverlay(ctx, S, L, H);
    if (S.summary) summary(ctx, S, L, hits);
    if (S.lobby) lobbyPanel(ctx, S, L, hits);
    if (S.waitRoom) roomPanel(ctx, S, L, hits);
    if (S.chatOpen) chatPanel(ctx, S, L, hits);
    if (S.toolsOpen) toolsDrawer(ctx, S, L, hits);
    if (S.pauseOpen) pausePanel(ctx, S, L, hits);
    if (S.statsOpen) statsPanel(ctx, S, L, hits);
    if (S.replayOpen) replayPanel(ctx, S, L, hits);
    if (S.testMenu) testPanel(ctx, S, L, hits);
    if (S.guideOpen) guidePanel(ctx, S, L, hits);
    if (S.ask) askPanel(ctx, S, L, hits);
    if (S.toast) toast(ctx, S, L);
    ctx.restore();
    return hits;
  }

  var exp = { draw: draw, layout: layout, C: C, SEAT_NAMES: SEAT_NAMES };
  if (typeof module === 'object' && module.exports) module.exports = exp;
  else (window.VIEWS = exp);
})();
