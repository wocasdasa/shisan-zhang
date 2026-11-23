// 音效：不依赖音频文件，全部用 WebAudio 合成
// 微信小游戏走 wx.createWebAudioContext，浏览器走 AudioContext
(function () {
  var isWx = (typeof wx !== 'undefined') && (typeof wx.createWebAudioContext === 'function');
  var ctx = null;
  var master = null;
  var ready = false;

  function init() {
    if (ready) return;
    try {
      if (isWx) ctx = wx.createWebAudioContext();
      else if (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (!ctx || !ctx.createGain) return;
      master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(ctx.destination);
      ready = true;
    } catch (e) { ready = false; }
  }

  function resume() {
    if (!ready) init();
    if (!ready) return;
    try { if (ctx.state === 'suspended' && ctx.resume) ctx.resume(); } catch (e) {}
  }

  function tone(freq, dur, gain, type, endFreq, delay) {
    if (!ready) return;
    try {
      var t = ctx.currentTime + (delay || 0);
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(master);
      osc.start(t); osc.stop(t + dur + 0.02);
    } catch (e) {}
  }

  function noise(dur, cutoff, gain, kind, delay) {
    if (!ready) return;
    try {
      var t = ctx.currentTime + (delay || 0);
      var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) {
        var env = 1 - i / len;
        data[i] = (Math.random() * 2 - 1) * env * env;
      }
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var filter = ctx.createBiquadFilter();
      filter.type = kind || 'lowpass';
      filter.frequency.value = cutoff;
      var g = ctx.createGain();
      g.gain.value = gain;
      src.connect(filter); filter.connect(g); g.connect(master);
      src.start(t);
    } catch (e) {}
  }

  // ---------- 出牌语音播报（豆包音色，本地预合成，拼读「牌型 + 花色点数」） ----------
  // 音频由 tools/voice-export.js 从豆包 TTS 一次合成后按静音切段：minigame/audio/voice/*.wav
  // 原子词表：8 个牌型词（k_*）+ 4 个花色词（s_0..s_3 = ♦♣♥♠）+ 13 个点数词（r_2..r_14）
  var VOICE_DIR = 'audio/voice/';
  var KIND_VOICE = {
    single: 'k_single', pair: 'k_pair', trio: 'k_trio', straight: 'k_straight',
    flush: 'k_flush', fullhouse: 'k_fullhouse', four: 'k_four', straightflush: 'k_straightflush'
  };
  var voiceWx = null, voiceHtml = null, voiceQ = [], voiceBusy = false;

  function voicePump() {
    if (voiceBusy || !voiceQ.length) return;
    var file = voiceQ.shift();
    var src = VOICE_DIR + file + '.wav';
    voiceBusy = true;
    try {
      if (isWx && typeof wx.createInnerAudioContext === 'function') {
        if (!voiceWx) {
          voiceWx = wx.createInnerAudioContext();
          voiceWx.volume = 0.9;
          voiceWx.onEnded(function () { voiceBusy = false; voicePump(); });
          voiceWx.onError(function () { voiceBusy = false; voicePump(); });
        }
        try { voiceWx.stop(); } catch (e) {}
        voiceWx.src = src;
        voiceWx.play();
        return;
      }
      if (typeof Audio !== 'undefined') {
        if (!voiceHtml) {
          voiceHtml = new Audio();
          voiceHtml.volume = 0.9;
          voiceHtml.addEventListener('ended', function () { voiceBusy = false; voicePump(); });
          voiceHtml.addEventListener('error', function () { voiceBusy = false; voicePump(); });
        }
        try { voiceHtml.pause(); } catch (e) {}
        voiceHtml.src = src;
        var pr = voiceHtml.play();
        if (pr && pr.catch) pr.catch(function () { voiceBusy = false; voicePump(); });
        return;
      }
    } catch (e) {}
    voiceBusy = false;
  }

  // 依次播报一组词；新播报进来时打断旧的（避免两条叠着响）
  function voiceSpeak(files) {
    voiceQ = (files || []).slice();
    voiceBusy = false;
    try { if (voiceWx) voiceWx.stop(); } catch (e) {}
    try { if (voiceHtml) voiceHtml.pause(); } catch (e) {}
    voicePump();
  }

  // 单张直接报「花色+点数」；对子/三个只补点数（不逐张念花色，避免播报过长）
  function detailFiles(kind, cards) {
    if (!cards || !cards.length) return [];
    var list = cards.slice().sort(function (a, b) { return b.s - a.s; });
    var c0 = list[0];
    if (!c0 || c0.r < 2 || c0.r > 14) return [];
    if (kind === 'single') {
      if (c0.s < 0 || c0.s > 3) return [];
      return ['s_' + c0.s, 'r_' + c0.r];
    }
    if (kind === 'pair' || kind === 'trio') return ['r_' + c0.r];
    return [];
  }

  var bank = {
    deal: function () { noise(0.035, 1100, 0.3, 'bandpass'); },    tap: function () { tone(1150, 0.02, 0.055, 'square'); },
    draw: function () {
      noise(0.05, 3200, 0.42, 'highpass');
      tone(560, 0.075, 0.15, 'triangle', 980);
      tone(920, 0.09, 0.1, 'triangle', 1320, 0.06);
    },
    ret: function () {
      tone(720, 0.09, 0.14, 'sine', 470);
      tone(470, 0.12, 0.11, 'sine', 320, 0.09);
      noise(0.03, 950, 0.16, 'bandpass', 0.01);
    },
    tick: function () { tone(1020, 0.028, 0.09, 'square'); },
    shock: function () {
      tone(120, 0.15, 0.2, 'sine', 62);
      noise(0.09, 520, 0.3, 'lowpass');
    },
    play: function () {
      noise(0.055, 2400, 0.55, 'lowpass');
      tone(150, 0.07, 0.16, 'sine', 90);
    },
    pass: function () { noise(0.075, 900, 0.22, 'lowpass'); },
    select: function () { tone(880, 0.028, 0.1, 'triangle'); },
    turn: function () { tone(600, 0.055, 0.14, 'triangle'); tone(760, 0.05, 0.12, 'triangle', null, 0.09); },
    win: function () {
      tone(523, 0.12, 0.2, 'triangle');
      tone(659, 0.12, 0.2, 'triangle', null, 0.11);
      tone(784, 0.13, 0.22, 'triangle', null, 0.22);
      tone(1046, 0.2, 0.22, 'triangle', null, 0.33);
    },
    lose: function () {
      tone(392, 0.14, 0.18, 'sine');
      tone(294, 0.22, 0.16, 'sine', null, 0.14);
    },
    // ♠3/♠A 亮出：220Hz 正弦 0.5s 指数衰减 + 440 泛音
    identity: function () {
      tone(220, 0.5, 0.22, 'sine');
      tone(440, 0.5, 0.08, 'sine');
    },
    // 独食揭示：低通噪声鼓点两下（间隔 0.18s）+ 高通噪声锣 0.4s
    lone: function () {
      noise(0.08, 480, 0.42, 'lowpass');
      noise(0.08, 480, 0.42, 'lowpass', 0.18);
      noise(0.4, 3400, 0.2, 'highpass', 0.36);
    }
  };

  var A = {
    enabled: true,
    init: init,
    unlock: resume,
    play: function (name) {
      if (!A.enabled) return;
      if (!ready) init();
      var f = bank[name];
      if (f) f();
    },
    // 按牌型分档：牌越大，音越重
    playKind: function (k) {
      if (!A.enabled) return;
      if (!ready) init();
      function seq(freqs, dur, gain, gap, type) {
        for (var i = 0; i < freqs.length; i++) tone(freqs[i], dur, gain, type || 'triangle', null, i * gap);
      }
      if (k === 'pair') seq([660, 880], 0.06, 0.11, 0.07);
      else if (k === 'trio') seq([520, 660, 820], 0.07, 0.11, 0.07);
      else if (k === 'straight') seq([523, 659, 784, 988, 1175], 0.09, 0.09, 0.055);
      else if (k === 'flush') { noise(0.16, 2400, 0.28, 'highpass'); tone(880, 0.12, 0.1, 'sine', 1240); }
      else if (k === 'fullhouse') seq([392, 494, 587, 784], 0.1, 0.11, 0.085);
      else if (k === 'four') {
        tone(92, 0.22, 0.26, 'sine', 52);
        noise(0.14, 620, 0.34, 'lowpass');
        tone(224, 0.16, 0.16, 'square', 110);
      } else if (k === 'straightflush') {
        seq([523, 659, 784, 988, 1175, 1568], 0.1, 0.12, 0.05);
        noise(0.22, 3200, 0.3, 'highpass');
        tone(130, 0.2, 0.16, 'sine', 70);
      }
    },
    toggle: function () { A.enabled = !A.enabled; resume(); return A.enabled; },
    // 播报这手出了什么：单张直接报「梅花2」；对子/三个报「对子K」「三个3」；其余只报牌型
    say: function (kind, cards) {
      if (!A.enabled) return;
      var kindFile = kind && KIND_VOICE[kind];
      if (!kindFile) return;
      if (kind === 'single') { voiceSpeak(detailFiles(kind, cards)); return; }
      voiceSpeak([kindFile].concat(detailFiles(kind, cards)));
    }
  };

  if (typeof module === 'object' && module.exports) module.exports = A;
  else (window.SFX = A);
})();
