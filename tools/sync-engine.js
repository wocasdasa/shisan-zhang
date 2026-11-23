// 把根目录 engine/ 同步到 minigame/js/engine/（小游戏内不能引用工程外的文件，只能复制一份）
// 用法：node tools/sync-engine.js
// 每次改完 engine/ 里的规则代码都要跑一次，否则小游戏跑的是旧逻辑。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'engine');
const dstDir = path.join(root, 'minigame', 'js', 'engine');

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js'));
let copied = 0, same = 0;

files.forEach((f) => {
  const src = fs.readFileSync(path.join(srcDir, f), 'utf8');
  const dstPath = path.join(dstDir, f);
  const old = fs.existsSync(dstPath) ? fs.readFileSync(dstPath, 'utf8') : null;
  if (old === src) { same++; return; }
  fs.writeFileSync(dstPath, src, 'utf8');
  copied++;
  console.log('  同步 ' + f);
});

// 反向检查：minigame/js/engine 里多出来的文件（说明 engine/ 删过但副本没删）
const extra = fs.readdirSync(dstDir)
  .filter((f) => f.endsWith('.js') && !files.includes(f));
extra.forEach((f) => console.log('  注意：minigame/js/engine/' + f + ' 在 engine/ 里已不存在'));

console.log('完成：复制 ' + copied + ' 个，已一致 ' + same + ' 个' +
  (extra.length ? '，多余 ' + extra.length + ' 个' : ''));
