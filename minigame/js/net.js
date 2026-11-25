// 联机传输层
// 微信小游戏：优先走云开发（wx.cloud.callFunction + 轮询房间状态），无需服务器与域名
// 浏览器 / 备用：原生 WebSocket
(function () {
  var isWx = (typeof wx !== 'undefined') && (typeof wx.connectSocket === 'function');
  var hasCloud = (typeof wx !== 'undefined') && wx.cloud && (typeof wx.cloud.callFunction === 'function');
  // 云开发分支当前只有链路桩（没有房间逻辑）：默认关闭，避免小游戏里 create/join 永远收不到回包
  // 要真用云开发，先 wx.setStorageSync('gx13_cloud', '1') 并把云函数补齐
  var cloudOn = false;
  try {
    cloudOn = !!hasCloud && String(wx.getStorageSync('gx13_cloud') || '') === '1';
  } catch (e) { cloudOn = false; }

  // 构建期默认地址（minigame/js/config.js）；留空表示不覆盖
  var CFG = {};
  try {
    if (typeof module === 'object' && module.exports && require) CFG = require('./config.js') || {};
  } catch (e) { CFG = {}; }

  // 云开发环境（开通云开发后控制台可见；也可用 wx.setStorageSync('gx13_env', 'xxx') 覆盖）
  var ENV_KEY = 'gx13_env';
  var DEFAULT_ENV = (typeof GX_CLOUD_ENV !== 'undefined' && GX_CLOUD_ENV) || 'cloud1-d7g8xcknn7afb1637';
  var CLOUD_ENV = DEFAULT_ENV;
  try {
    if (hasCloud) {
      var savedEnv = wx.getStorageSync(ENV_KEY);
      if (savedEnv) CLOUD_ENV = savedEnv;
    }
  } catch (e) {}

  var sock = null;
  var handlers = { open: null, message: null, close: null, error: null };
  var queue = [];
  var open = false;

  // 心跳：每 25 秒发一次 ping；60 秒没有任何入站消息就判定断线，交给上层重连
  // 公网 NAT/代理通常会把 60~90 秒没有数据的连接掐掉，没有心跳就会出现「人不掉但消息发不出去」
  // 两个值都可以在 config.js 里覆盖（联调时能调短，正式环境用默认）
  var HB_MS = (CFG && CFG.HB_MS) || 25000;
  var HB_DEAD_MS = (CFG && CFG.HB_DEAD_MS) || 60000;
  var hbTimer = null;
  var lastMsgAt = 0;
  var closedNotified = false;

  // 云开发模式的状态
  var cloudMode = false;
  var cloudRoom = '';
  var pollTimer = null;
  var lastStateJson = '';
  var inFlight = false;
  var POLL_MS = 800;

  function defaultUrl() {
    if (cloudOn) return '云开发 ' + CLOUD_ENV;
    if (isWx) {
      try {
        var saved = wx.getStorageSync('gx13_server');
        if (saved) return saved;
      } catch (e) {}
      if (CFG && CFG.SERVER_URL) return CFG.SERVER_URL;
      return 'ws://127.0.0.1:8787';
    }
    if (typeof window !== 'undefined' && window.location) {
      var q = /(?:\?|&)server=([^&]+)/.exec(window.location.search || '');
      if (q) return decodeURIComponent(q[1]);
      try {
        var savedB = window.localStorage && window.localStorage.getItem('gx13_server');
        if (savedB) return savedB;
      } catch (e) {}
      var host = window.location.hostname || '127.0.0.1';
      if (!host || host === '') host = '127.0.0.1';
      // 预览页被挂在 https 上时，默认应该走 wss，而不是退化成明文端口
      if (window.location.protocol === 'https:') return 'wss://' + host;
      return 'ws://' + host + ':8787';
    }
    if (CFG && CFG.SERVER_URL) return CFG.SERVER_URL;
    return 'ws://127.0.0.1:8787';
  }

  function on(evt, fn) { handlers[evt] = fn; }

  function startHeartbeat() {
    stopHeartbeat();
    lastMsgAt = Date.now();
    hbTimer = setInterval(function () {
      if (!open) return;
      rawSend({ t: 'ping' });
      if (Date.now() - lastMsgAt > HB_DEAD_MS) {
        fire('close'); // 先通知上层进入重连，再关掉这条已经没救的连接
        close();
      }
    }, HB_MS);
  }

  function stopHeartbeat() {
    if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
  }

  function fire(evt, arg) {
    if (evt === 'open') {
      open = true;
      closedNotified = false;
      lastMsgAt = Date.now();
      startHeartbeat();
      if (handlers.open) handlers.open();
      while (queue.length) send(queue.shift());
      return;
    }
    if (evt === 'close') {
      if (closedNotified) return;
      closedNotified = true;
      open = false;
      stopHeartbeat();
    }
    if (handlers[evt]) handlers[evt](arg);
  }

  // ---------- 云开发 ----------
  function cloudInit() {
    if (!hasCloud) return false;
    try {
      wx.cloud.init({ env: CLOUD_ENV, traceUser: false });
      return true;
    } catch (e) {
      try { wx.cloud.init(); return true; } catch (e2) { return false; }
    }
  }

  function cloudCall(action, extra) {
    var data = { action: action, room: cloudRoom };
    if (extra) for (var k in extra) data[k] = extra[k];
    return new Promise(function (resolve, reject) {
      wx.cloud.callFunction({ name: 'gx13', data: data, success: function (r) { resolve(r && r.result ? r.result : null); }, fail: reject });
    });
  }

  function dispatchState(state) {
    if (!state) return;
    var json = JSON.stringify(state);
    if (json === lastStateJson) return;
    lastStateJson = json;
    if (handlers.message) handlers.message(state);
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      if (!cloudRoom || inFlight) return;
      inFlight = true;
      cloudCall('state').then(function (res) {
        inFlight = false;
        if (!res) return;
        if (res.t === 'err') { fire('close'); return; }
        dispatchState(res);
      }).catch(function () { inFlight = false; });
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function cloudConnect() {
    cloudMode = true;
    if (!cloudInit()) { fire('error', { msg: '云开发初始化失败' }); return; }
    // 延后一个 tick 抛 open，让上层先把 pending 消息准备好
    setTimeout(function () { fire('open'); }, 0);
  }

  function cloudSend(obj) {
    if (!obj || !obj.t) return;
    var t = obj.t;
    if (t === 'ping' || t === 'ready') return;
    if (t === 'create' || t === 'join') {
      var act = t;
      var extra = { name: obj.name || '玩家' };
      if (t === 'create') extra.rounds = obj.rounds;
      else extra.room = obj.room;
      cloudCall(act, extra).then(function (res) {
        if (!res) return;
        if (res.t === 'err') { if (handlers.message) handlers.message(res); return; }
        if (res.t === 'joined') {
          cloudRoom = res.room;
          try { wx.setStorageSync('gx13_room', res.room); } catch (e) {}
          if (handlers.message) handlers.message({ t: 'joined', room: res.room });
          lastStateJson = '';
          if (res.state) dispatchState(res.state);
          startPolling();
        }
      }).catch(function (e) { fire('error', e); });
      return;
    }
    if (t === 'leave') {
      cloudCall('leave').catch(function () {});
      cloudRoom = '';
      stopPolling();
      return;
    }
    if (!cloudRoom) {
      try {
        var savedRoom = wx.getStorageSync('gx13_room');
        if (savedRoom) cloudRoom = savedRoom;
      } catch (e) {}
      if (!cloudRoom) return;
    }
    var payload = { cards: obj.cards, v: obj.v, seatRel: obj.seatRel };
    cloudCall(t, payload).then(function (res) {
      if (!res) return;
      if (res.t === 'err') {
        if (handlers.message) handlers.message(res);
        if (res.state) dispatchState(res.state);
        return;
      }
      if (res.t === 'state') { dispatchState(res); startPolling(); }
    }).catch(function (e) { fire('error', e); });
  }

  // ---------- WebSocket ----------
  function wsConnect(url) {
    cloudMode = false;
    close();
    url = url || defaultUrl();
    open = false;
    var s = null;
    try {
      if (isWx) {
        s = wx.connectSocket({ url: url });
        sock = s;
        // 只认当前这条 socket 的回调，避免旧的连接晚到的 close 把新连接的状态冲掉
        s.onOpen(function () { if (sock === s) fire('open'); });
        s.onMessage(function (res) { if (sock === s) parse(res.data); });
        s.onClose(function () { if (sock === s) fire('close'); });
        s.onError(function (e) { if (sock === s) fire('error', e); });
      } else {
        s = new WebSocket(url);
        sock = s;
        s.onopen = function () { if (sock === s) fire('open'); };
        s.onmessage = function (e) { if (sock === s) parse(e.data); };
        s.onclose = function () { if (sock === s) fire('close'); };
        s.onerror = function (e) { if (sock === s) fire('error', e); };
      }
    } catch (e) { fire('error', e); }
  }

  function parse(raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    lastMsgAt = Date.now();
    if (handlers.message) handlers.message(msg);
  }

  function rawSend(obj) {
    var text = JSON.stringify(obj);
    try {
      if (isWx) {
        if (sock && sock.send) sock.send({ data: text });
      } else if (sock && sock.readyState === 1) {
        sock.send(text);
      }
    } catch (e) {}
  }

  // ---------- 统一接口 ----------
  function connect(url) {
    if (cloudOn && (!url || url.indexOf('ws://') < 0 && url.indexOf('wss://') < 0)) {
      cloudConnect();
      return;
    }
    wsConnect(url);
  }

  function send(obj) {
    if (!open) { queue.push(obj); return; }
    if (cloudMode) { cloudSend(obj); return; }
    rawSend(obj);
  }

  function close() {
    var wasOpen = open;
    open = false;
    queue.length = 0;
    stopPolling();
    stopHeartbeat();
    try {
      if (sock) { if (isWx) sock.close({}); else sock.close(); }
    } catch (e) {}
    sock = null;
    if (wasOpen) fire('close'); // 手动断开也要给上层一个明确的收尾信号
  }

  var NET = {
    isWx: isWx,
    isCloud: cloudOn,
    hasCloudSdk: hasCloud,
    cloudEnv: function () { return CLOUD_ENV; },
    defaultUrl: defaultUrl,
    connect: connect,
    send: send,
    close: close,
    on: on,
    room: function () { return cloudRoom; },
    url: function () { return defaultUrl(); }
  };

  if (typeof module === 'object' && module.exports) module.exports = NET;
  else (window.NET = NET);
})();
