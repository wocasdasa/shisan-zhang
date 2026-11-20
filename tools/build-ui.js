// 把 engine/*.js + ui/app.js + ui/app.css 打进一个自包含 HTML
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const ENGINE_FILES = ['cards', 'rules', 'camp', 'info', 'hand', 'moves', 'table', 'ai', 'ai2', 'settle', 'tribute'];

const engine = ENGINE_FILES.map(function (name) {
  return '/* ===== engine/' + name + '.js ===== */\n' + fs.readFileSync(path.join(root, 'engine', name + '.js'), 'utf8');
}).join('\n');

const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'ui', 'app.css'), 'utf8');
const tpl = fs.readFileSync(path.join(root, 'ui', 'template.html'), 'utf8');

function safe(src) { return src.replace(/<\/script>/gi, '<\\/script>'); }

const out = tpl
  .replace('/*__CSS__*/', function () { return css; })
  .replace('/*__ENGINE__*/', function () { return safe(engine); })
  .replace('/*__APP__*/', function () { return safe(app); });

const target = path.join(root, 'ui', '独食牌桌.html');
fs.writeFileSync(target, out, 'utf8');
console.log('已生成：' + target);
console.log('大小：' + (fs.statSync(target).size / 1024).toFixed(1) + ' KB');
