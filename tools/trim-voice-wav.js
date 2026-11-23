// 剪掉播报 WAV 首尾静音；按 RIFF 块结构定位 data 块（SAPI 输出为 WAVE_FORMAT_EXTENSIBLE，
// data 不在固定偏移 44），保留原有 fmt 等块不动。
const fs = require('fs');
const path = require('path');
const dir = process.argv[2] || 'minigame/audio/voice';
const TH = 500;      // 采样幅度阈值（32767 满幅）
const PAD = 480;     // 30ms @16kHz

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.wav'))) {
  const p = path.join(dir, f);
  const buf = fs.readFileSync(p);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    console.log(f, 'not RIFF/WAVE, skipped'); continue;
  }
  // 找 data 块
  let o = 12, dataOff = -1, dataSize = 0;
  while (o + 8 <= buf.length) {
    const id = buf.toString('ascii', o, o + 4);
    const sz = buf.readUInt32LE(o + 4);
    if (id === 'data') { dataOff = o + 8; dataSize = sz; break; }
    o += 8 + sz + (sz % 2);
  }
  if (dataOff < 0) { console.log(f, 'no data chunk, skipped'); continue; }
  const n = Math.floor(dataSize / 2);
  let first = -1, last = -1;
  for (let i = 0; i < n; i++) {
    const v = buf.readInt16LE(dataOff + i * 2);
    if (v > TH || v < -TH) { if (first < 0) first = i; last = i; }
  }
  if (first < 0) { console.log(f, 'silent, skipped'); continue; }
  const a = Math.max(0, first - PAD), b = Math.min(n - 1, last + PAD);
  const cnt = b - a + 1;
  const samples = buf.slice(dataOff + a * 2, dataOff + (b + 1) * 2);

  // 统一写成标准 PCM WAV 头（SAPI 输出的是 WAVE_FORMAT_EXTENSIBLE，部分 iOS 版本不识别）
  const rate = 16000, ch = 1, bits = 16;
  const out = Buffer.alloc(44 + cnt * 2);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + cnt * 2, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);                 // PCM
  out.writeUInt16LE(ch, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * ch * bits / 8, 28);
  out.writeUInt16LE(ch * bits / 8, 32);
  out.writeUInt16LE(bits, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(cnt * 2, 40);
  samples.copy(out, 44);
  fs.writeFileSync(p, out);
  console.log(f, n, '->', cnt, 'samples (pcm)');
}
