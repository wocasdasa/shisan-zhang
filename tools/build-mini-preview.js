// 生成浏览器预览页：把 minigame 里的 CommonJS 模块打成一个可直接双击打开的 HTML
// 用途只有一个——在真机上微信开发者工具之外，快速看画面、点得到、不报错
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mroot = path.join(root, 'minigame');

const FILES = [
  'js/engine/cards.js', 'js/engine/rules.js', 'js/engine/camp.js', 'js/engine/info.js',
  'js/engine/hand.js', 'js/engine/moves.js', 'js/engine/table.js',
  'js/engine/ai.js', 'js/engine/ai2.js', 'js/engine/settle.js', 'js/engine/tribute.js',
  'js/engine/index.js', 'js/config.js', 'js/audio.js', 'js/net.js', 'js/platform.js', 'js/views.js', 'js/app.js'
];

function safe(src) { return src.replace(/<\/script>/gi, '<\\/script>'); }

const defs = FILES.map(function (f) {
  const src = fs.readFileSync(path.join(mroot, f), 'utf8');
  return 'define(' + JSON.stringify(f) + ', function (require, module, exports) {\n' + src + '\n});';
}).join('\n\n');

const runtime = `
window.onerror = function (m, f, l) { document.title = 'JSERROR: ' + m + ' @' + l; };
window.addEventListener('unhandledrejection', function (e) { document.title = 'JSERROR: ' + e.reason; });
(function () {
  var defs = {}, cache = {};
  window.define = function (p, fn) { defs[p] = fn; };
  function resolve(from, p) {
    if (p.charAt(0) !== '.') return p;
    var seg = (from.split('/').slice(0, -1).join('/') + (from ? '/' : '') + p).split('/');
    var out = [];
    seg.forEach(function (s) { if (s === '..') out.pop(); else if (s !== '.' && s !== '') out.push(s); });
    return out.join('/');
  }
  function makeRequire(from) {
    return function (p) {
      var key = resolve(from, p);
      if (cache[key]) return cache[key].exports;
      if (!defs[key]) throw new Error('module not found: ' + key);
      var m = { exports: {} };
      cache[key] = m;
      defs[key](makeRequire(key), m, m.exports);
      return m.exports;
    };
  }
  window.__boot = function () {
    var app = makeRequire('')('./js/app.js');
    window.__app = app;
    app.boot();
  };
})();
`;

const css = `
html, body { margin: 0; padding: 0; background: #08120d; height: 100%; overflow: hidden; }
body { display: block; }
#stage { width: 100vw; height: 100vh; overflow: hidden; }
canvas#game { width: 100%; height: 100%; display: block; }
`;

const html = '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>十三张·独食 — 小游戏预览</title><style>' + css + '</style></head>' +
  '<body><div id="stage"><canvas id="game"></canvas></div>' +
  '<script>' + runtime + '</script>' +
  '<script>' + safe(defs) + '</script>' +
  '<script>window.__boot();</script>' +
  '</body></html>';

fs.writeFileSync(path.join(mroot, 'preview.html'), html, 'utf8');
console.log('已生成 minigame/preview.html：' + (html.length / 1024).toFixed(1) + ' KB');
