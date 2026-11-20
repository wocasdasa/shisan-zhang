// 打包交付：小游戏前端 + 联机服务端 + 说明
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist', '十三张独食-小游戏工程.zip');

const items = [
  { src: 'minigame/game.js', zip: 'minigame/game.js' },
  { src: 'minigame/game.json', zip: 'minigame/game.json' },
  { src: 'minigame/project.config.json', zip: 'minigame/project.config.json' },
  { src: 'minigame/README.md', zip: 'minigame/README.md' },
  { src: 'minigame/js', zip: 'minigame/js', dir: true },
  { src: 'server', zip: 'server', dir: true },
  { src: 'engine', zip: 'engine', dir: true },
  { src: 'tools/wsclient.js', zip: 'tools/wsclient.js' },
  { src: 'tools/netbot.js', zip: 'tools/netbot.js' },
  { src: 'tools/hostbot.js', zip: 'tools/hostbot.js' }
];

const skipNames = /\.png$|preview\.html$|\.log$/;

function walk(base) {
  const list = [];
  (function rec(rel) {
    const abs = path.join(base, rel);
    fs.readdirSync(abs).forEach((name) => {
      const childRel = path.join(rel, name);
      const st = fs.statSync(path.join(abs, name));
      if (st.isDirectory()) rec(childRel);
      else if (!skipNames.test(name)) list.push(childRel);
    });
  })('');
  return list;
}

const files = []; // {name, data}
items.forEach((it) => {
  const abs = path.join(root, it.src);
  if (!fs.existsSync(abs)) return;
  if (it.dir) {
    walk(abs).forEach((rel) => {
      files.push({ name: it.zip + '/' + rel.split(path.sep).join('/'), abs: path.join(abs, rel) });
    });
  } else {
    files.push({ name: it.zip, abs });
  }
});

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const parts = [];
const central = [];
let offset = 0;

function dosTime(d) {
  return {
    time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31),
    date: (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
  };
}

files.forEach((f) => {
  const data = fs.readFileSync(f.abs);
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const st = fs.statSync(f.abs);
  const t = dosTime(st.mtime);
  const nameBuf = Buffer.from(f.name, 'utf8');
  const method = comp.length < data.length ? 8 : 0;
  const body = method === 8 ? comp : data;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(t.time, 10);
  local.writeUInt16LE(t.date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);

  parts.push(local, nameBuf, body);

  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(20, 4);
  cen.writeUInt16LE(20, 6);
  cen.writeUInt16LE(0x0800, 8);
  cen.writeUInt16LE(method, 10);
  cen.writeUInt16LE(t.time, 12);
  cen.writeUInt16LE(t.date, 14);
  cen.writeUInt32LE(crc, 16);
  cen.writeUInt32LE(body.length, 20);
  cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(nameBuf.length, 28);
  cen.writeUInt16LE(0, 30);
  cen.writeUInt16LE(0, 32);
  cen.writeUInt16LE(0, 34);
  cen.writeUInt16LE(0, 36);
  cen.writeUInt32LE(offset, 38);
  central.push(cen, nameBuf);

  offset += local.length + nameBuf.length + body.length;
});

const cenBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cenBuf.length, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);

fs.writeFileSync(out, Buffer.concat([Buffer.concat(parts), cenBuf, end]));
console.log('已打包 ' + out + '：' + files.length + ' 个文件，' +
  (fs.statSync(out).size / 1024).toFixed(1) + ' KB');
