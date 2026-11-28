// 联机传输层
// 微信小游戏：优先走云开发（wx.cloud.callFunction + 轮询房间状态），无需服务器与域名
// 浏览器 / 备用：原生 WebSocket
(function () {
  var isWx = (typeof wx !== 'undefined') && (typeof wx.connectSocket === 'function');
  var hasCloud = (typeof wx !== 'undefined') && wx.cloud && (typeof wx.cloud.callFunction === 'function');

  // 构建期配置（minigame/js/config.js）
  var CFG = {};
  try {
    if (typeof module === 'object' && module.exports && require) CFG = require('./config.js') || {};
  } catch (e) { CFG = {}; }

  // 微信端默认走云开发；浏览器没有 wx.cloud，自动走 WebSocket。
  // 调试自建服务端时，执行 wx.setStorageSync('gx13_cloud','0') 可切回 WebSocket。
  var cloudOn = false;
  try {
    if (hasCloud && CFG.CLOUD_ON !== false) {
      var savedCloud = String(wx.getStorageSync('gx13_cloud') || '');
      cloudOn = savedCloud !== '0';
      if (savedCloud === '1') cloudOn = true;
    }
  } catch (e) { cloudOn = false; }

  // 云开发环境（开通云开发后控制台可见；也可用 wx.setStorageSync('gx13_env', 'xxx') 覆盖）
  // 留空时用当前小游戏的默认云环境，少一处需要手填的配置。
  var ENV_KEY = 'gx13_env';
  var DEFAULT_ENV = (CFG && CFG.CLOUD_ENV) || (typeof GX_CLOUD_ENV !== 'undefined' && GX_CLOUD_ENV) || '';
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
  var cloudFails = 0;
  var POLL_MS = 800;

  function defaultUrl() {
    if (cloudOn) return '云开发 ' + (CLOUD_ENV || '当前环境');
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
      // 云开发用轮询保活，不能复用 WebSocket 的心跳，否则 60 秒没入站消息会误判断线
      if (!cloudMode) startHeartbeat();
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
      if (CLOUD_ENV) wx.cloud.init({ env: CLOUD_ENV, traceUser: false });
      else wx.cloud.init({ traceUser: false });
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

  function pollOnce() {
    if (!cloudRoom || inFlight) return;
    inFlight = true;
    cloudCall('state').then(function (res) {
      inFlight = false;
      if (!res) return;
      if (res.t === 'err') {
        // 房间被解散/座位被清掉：这不是网络断线，直接把玩家送回大厅
        if (res.code === 'roomMissing' || res.code === 'notInRoom') {
          cloudRoom = '';
          stopPolling();
          try { wx.removeStorageSync('gx13_room'); } catch (e) {}
          if (handlers.message) handlers.message({ t: 'roomClosed', msg: res.msg || '房间已解散' });
          return;
        }
        if (handlers.message) handlers.message(res);
        return;
      }
      if (res.t === 'busy') return;
      cloudFails = 0;
      dispatchState(res);
    }).catch(function () {
      inFlight = false;
      cloudFails++;
      // 偶发一次云函数超时不值得把整桌踢掉；连续 3 次（约 2.4 秒）才交给上层重连
      if (cloudFails >= 3) {
        cloudFails = 0;
        fire('error', { msg: '云开发连接失败，请检查网络后重试' });
        close();
      }
    });
  }

  function startPolling() {
    if (pollTimer) return;
    pollOnce();
    pollTimer = setInterval(pollOnce, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function cloudConnect() {
    cloudMode = true;
    cloudFails = 0;
    lastStateJson = '';
    stopHeartbeat();
    if (!cloudInit()) {
      queue.length = 0;
      fire('error', { msg: '云开发初始化失败：请先在开发者工具开通云开发，并上传 gx13 云函数' });
      return;
    }
    // 延后一个 tick 抛 open，让上层先把 pending 消息准备好
    setTimeout(function () { fire('open'); }, 0);
  }

  function handleCloudJoined(res, rejoin) {
    if (!res || res.t !== 'joined') return false;
    cloudRoom = res.room;
    cloudFails = 0;
    try { wx.setStorageSync('gx13_room', res.room); } catch (e) {}
    if (handlers.message) {
      handlers.message({ t: 'joined', room: res.room, seat: res.seat, key: res.key || 'cloud', rejoin: !!rejoin });
    }
    lastStateJson = '';
    if (res.state) dispatchState(res.state);
    startPolling();
    return true;
  }

  function handleCloudErr(res) {
    if (!res) return;
    if (res.t === 'err') {
      if (res.code === 'roomMissing' || res.code === 'notInRoom') {
        cloudRoom = '';
        stopPolling();
        try { wx.removeStorageSync('gx13_room'); } catch (e) {}
        if (handlers.message) handlers.message({ t: 'roomClosed', msg: res.msg || '房间已解散' });
        return;
      }
      if (handlers.message) handlers.message(res);
      if (res.state) dispatchState(res.state);
      return;
    }
    if (res.t === 'roomClosed') {
      cloudRoom = '';
      stopPolling();
      try { wx.removeStorageSync('gx13_room'); } catch (e) {}
      if (handlers.message) handlers.message(res);
      return;
    }
    if (res.t === 'busy') {
      if (handlers.message) handlers.message({ t: 'err', msg: res.msg || '房间正忙，请稍后再试' });
    }
  }

  function cloudSend(obj) {
    if (!obj || !obj.t) return;
    var t = obj.t;
    if (t === 'ping') return;

    // 建房 / 加入 / 快速开局 / 重连：都需要把云函数返回的 joined 交给上层
    if (t === 'create' || t === 'join' || t === 'quick' || t === 'rejoin') {
      var extra = { name: obj.name || '玩家' };
      if (t === 'create' || t === 'quick') {
        extra.rounds = obj.rounds;
        extra.cfg = obj.cfg;
      } else {
        extra.room = obj.room || cloudRoom;
      }
      cloudCall(t, extra).then(function (res) {
        if (!res) return;
        if (res.t === 'joined') { handleCloudJoined(res, t === 'rejoin'); return; }
        handleCloudErr(res);
      }).catch(function () {
        if (handlers.message) handlers.message({ t: 'err', msg: '云开发调用失败，请确认 gx13 云函数已上传' });
      });
      return;
    }

    if (t === 'leave') {
      cloudCall('leave').catch(function () {});
      cloudRoom = '';
      stopPolling();
      try { wx.removeStorageSync('gx13_room'); } catch (e) {}
      return;
    }

    if (!cloudRoom) {
      try {
        var savedRoom = wx.getStorageSync('gx13_room');
        if (savedRoom) cloudRoom = savedRoom;
      } catch (e) {}
      if (!cloudRoom) return;
    }

    var payload = {
      cards: obj.cards,
      v: obj.v,
      seatRel: obj.seatRel,
      kind: obj.kind,
      text: obj.text,
      name: obj.name,
      cfg: obj.cfg,
      room: obj.room,
      key: obj.key
    };
    cloudCall(t, payload).then(function (res) {
      if (!res) return;
      if (res.t === 'joined') { handleCloudJoined(res, t === 'rejoin'); return; }
      if (res.t === 'state') { dispatchState(res); startPolling(); return; }
      handleCloudErr(res);
    }).catch(function () {
      if (handlers.message) handlers.message({ t: 'err', msg: '云开发调用失败，请确认 gx13 云函数已上传' });
    });
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
