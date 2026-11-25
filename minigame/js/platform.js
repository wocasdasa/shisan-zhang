// 平台适配层：微信小游戏与浏览器预览共用同一份渲染/逻辑代码
// 竖屏按 750 宽设计；横屏按 750 高设计（宽度随屏幕比例伸缩）
(function () {
  var BASE = 750;
  var isWx = (typeof wx !== 'undefined') && (typeof wx.createCanvas === 'function');

  var canvas = null;
  var ctx = null;
  var dpr = 1;
  var scale = 1;
  var width = BASE;
  var height = 1334;
  var logicalW = BASE;
  var logicalH = 1334;
  var landscape = false;
  var tapHandler = null;
  var moveHandler = null;
  var endHandler = null;
  var drawFn = null;
  var dirty = true;

  function init() {
    if (isWx) {
      var info = wx.getSystemInfoSync();
      dpr = info.pixelRatio || 2;
      canvas = wx.createCanvas();
      width = info.windowWidth;
      height = info.windowHeight;
    } else {
      canvas = document.getElementById('game');
      dpr = window.devicePixelRatio || 1;
      width = window.innerWidth || canvas.clientWidth;
      height = window.innerHeight || canvas.clientHeight;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
    }
    landscape = width >= height;
    if (landscape) {
      scale = height / BASE;
      logicalH = BASE;
      logicalW = Math.round(width / scale);
    } else {
      scale = width / BASE;
      logicalW = BASE;
      logicalH = Math.round(height / scale);
    }
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    bindTouch();
    return api;
  }

  function logical(x, y) {
    return { x: x / scale, y: y / scale };
  }

  function bindTouch() {
    if (isWx) {
      wx.onTouchStart(function (e) {
        var t = e.touches && e.touches[0];
        if (!t || !tapHandler) return;
        var p = logical(t.clientX, t.clientY);
        tapHandler(p.x, p.y);
      });
      if (wx.onTouchMove) {
        wx.onTouchMove(function (e) {
          var t = e.touches && e.touches[0];
          if (!t || !moveHandler) return;
          var p = logical(t.clientX, t.clientY);
          moveHandler(p.x, p.y);
        });
      }
      if (wx.onTouchEnd) {
        wx.onTouchEnd(function () { if (endHandler) endHandler(); });
      }
      return;
    }
    var rect = null;
    var fire = function (clientX, clientY) {
      if (!tapHandler) return;
      rect = canvas.getBoundingClientRect();
      var p = logical(clientX - rect.left, clientY - rect.top);
      tapHandler(p.x, p.y);
    };
    var move = function (clientX, clientY) {
      if (!moveHandler) return;
      rect = rect || canvas.getBoundingClientRect();
      var p = logical(clientX - rect.left, clientY - rect.top);
      moveHandler(p.x, p.y);
    };
    var dragging = false;
    canvas.addEventListener('touchstart', function (e) {
      e.preventDefault();
      dragging = true;
      var t = e.changedTouches && e.changedTouches[0];
      if (t) fire(t.clientX, t.clientY);
    }, { passive: false });
    canvas.addEventListener('touchmove', function (e) {
      e.preventDefault();
      if (!dragging) return;
      var t = e.changedTouches && e.changedTouches[0];
      if (t) move(t.clientX, t.clientY);
    }, { passive: false });
    canvas.addEventListener('touchend', function () {
      dragging = false;
      if (endHandler) endHandler();
    });
    canvas.addEventListener('mousedown', function (e) {
      dragging = true;
      fire(e.clientX, e.clientY);
    });
    canvas.addEventListener('mousemove', function (e) {
      if (dragging) move(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', function () {
      dragging = false;
      if (endHandler) endHandler();
    });
  }

  function tick() {
    if (dirty && drawFn) {
      dirty = false;
      drawFn();
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick);
    else setTimeout(tick, 16);
  }

  var api = function () {};

  // 取一行文字（改名等）：微信走系统键盘，浏览器预览退化为 prompt
  function askText(title, def, maxLen, cb) {
    maxLen = maxLen || 12;
    if (isWx && wx.showKeyboard) {
      var done = false;
      var finish = function (val) {
        if (done) return;
        done = true;
        if (wx.offKeyboardConfirm) wx.offKeyboardConfirm();
        if (wx.offKeyboardComplete) wx.offKeyboardComplete();
        if (wx.offKeyboardInput) wx.offKeyboardInput();
        if (wx.hideKeyboard) wx.hideKeyboard({});
        cb(String(val == null ? def : val).slice(0, maxLen));
      };
      if (wx.onKeyboardConfirm) wx.onKeyboardConfirm(function (res) { finish(res && res.value); });
      if (wx.onKeyboardComplete) wx.onKeyboardComplete(function (res) { finish(res && res.value); });
      wx.showKeyboard({
        defaultValue: String(def || ''), maxLength: maxLen, multiple: false,
        confirmHold: false, confirmType: 'done'
      });
      return true;
    }
    try {
      var v = window.prompt(title || '输入', String(def || ''));
      if (v == null) return false;
      cb(String(v).trim().slice(0, maxLen));
      return true;
    } catch (e) { return false; }
  }

  // 轻震：微信 wx.vibrateShort，浏览器 navigator.vibrate
  function haptic(kind) {
    try {
      if (isWx && wx.vibrateShort) { wx.vibrateShort({ type: kind || 'light' }); return; }
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(kind === 'heavy' ? 40 : 18);
    } catch (e) {}
  }

  var exportsObj = {
    isWx: isWx,
    init: init,
    ctx: function () { return ctx; },
    canvas: function () { return canvas; },
    w: function () { return logicalW; },
    h: function () { return logicalH; },
    landscape: function () { return landscape; },
    bindTap: function (fn) { tapHandler = fn; },
    bindMove: function (fn) { moveHandler = fn; },
    bindEnd: function (fn) { endHandler = fn; },
    debug: function () { return { tap: !!tapHandler, canvas: canvas === document.getElementById('game') }; },
    markDirty: function () { dirty = true; },
    askText: askText,
    haptic: haptic,
    start: function (fn) { drawFn = fn; dirty = true; tick(); }
  };

  if (typeof module === 'object' && module.exports) module.exports = exportsObj;
  else (window.PLATFORM = exportsObj);
})();
