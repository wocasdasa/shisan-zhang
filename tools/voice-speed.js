// 把已定稿的语音词条整体提速：重采样加速（时长 = 原长/因子，音高同步升高约 0.9 个半音，几乎不可察）
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const factor = Number(process.argv[3] || 1.07);

function readPcm(file) {
  const b = fs.readFileSync(file);
  return {
    sr: b.readUInt32LE(24), ch: b.readUInt16LE(22), bits: b.readUInt16LE(34),
    data: b.slice(44)
  };
}

function writePcm(file, sr, ch, bits, samples) {
  const sz = samples.length * 2;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + sz, 4); h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(ch, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * ch * 2, 28);
  h.writeUInt16LE(ch * 2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii'); h.writeUInt32LE(sz, 40);
  const d = Buffer.alloc(sz);
  for (let i = 0; i < samples.length; i++) d.writeInt16LE(Math.round(samples[i] * 32767), i * 2);
  fs.writeFileSync(file, Buffer.concat([h, d]));
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.wav')).sort();
let before = 0, after = 0;
files.forEach((f) => {
  const p = path.join(dir, f);
  const w = readPcm(p);
  const n = w.data.length / 2;
  const nOut = Math.floor(n / factor);
  const out = new Float32Array(nOut);
  for (let i = 0; i < nOut; i++) {
    const t = i * factor;
    const i0 = Math.floor(t), i1 = Math.min(i0 + 1, n - 1), fr = t - i0;
    const a = w.data.readInt16LE(i0 * 2) / 32768;
    const b = w.data.readInt16LE(i1 * 2) / 32768;
    out[i] = a * (1 - fr) + b * fr;
  }
  before += n;
  after += nOut;
  writePcm(p, w.sr, w.ch, w.bits, out);
});
console.log('files', files.length, 'samples', before, '->', after, 'ratio', (after / before).toFixed(3));
