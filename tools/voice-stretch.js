// 语音整体再提速但不改音色：SOLA（重叠相加 + 相似段对齐）时长压缩，音高保持不变
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const factor = Number(process.argv[3] || 1.12); // >1 表示更快

function readPcm(file) {
  const b = fs.readFileSync(file);
  const sr = b.readUInt32LE(24), ch = b.readUInt16LE(22);
  const n = b.length - 44;
  const s = new Float32Array(n / 2);
  for (let i = 0; i < s.length; i++) s[i] = b.readInt16LE(44 + i * 2) / 32768;
  return { sr, ch, s };
}

function writePcm(file, sr, ch, s) {
  const sz = s.length * 2;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + sz, 4); h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(ch, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * ch * 2, 28);
  h.writeUInt16LE(ch * 2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii'); h.writeUInt32LE(sz, 40);
  const d = Buffer.alloc(sz);
  for (let i = 0; i < s.length; i++) {
    const v = Math.max(-1, Math.min(1, s[i]));
    d.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  fs.writeFileSync(file, Buffer.concat([h, d]));
}

// 周期 hann 窗（相邻窗相加恰为 1）
function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

function sola(x, factor) {
  const N = 480;            // 30ms @16k
  const Hs = N / 2;         // 合成步长
  const Ha = Math.round(Hs * factor); // 分析步长
  const K = Hs;             // 对齐搜索范围 ±30ms
  const w = hann(N);
  const outLen = Math.ceil(x.length / factor) + N;
  const out = new Float32Array(outLen);

  let a = 0, o = 0;
  // 首帧
  for (let i = 0; i < N && i < x.length; i++) out[o + i] += w[i] * x[i];
  o += Hs;

  while (o + N < outLen) {
    let target = a + Ha;
    let bestK = 0, best = -Infinity;
    if (target + K + Hs <= x.length) {
      for (let k = -K; k <= K; k += 1) {
        let s1 = 0, s2 = 0, s3 = 0;
        for (let i = 0; i < Hs; i++) {
          const xv = x[target + k + i];
          const yv = out[o + i];
          s1 += xv * yv; s2 += xv * xv; s3 += yv * yv;
        }
        const score = (s1 * s1) / (s2 * s3 + 1e-9);
        if (score > best) { best = score; bestK = k; }
      }
    }
    a = target + bestK;
    if (a < 0) a = 0;
    if (a + N >= x.length) break;
    for (let i = 0; i < N; i++) out[o + i] += w[i] * x[a + i];
    o += Hs;
  }
  // 用实际占用长度截断（去掉尾部补齐）
  const real = Math.min(outLen, Math.round(x.length / factor));
  return out.subarray(0, real);
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.wav')).sort();
let before = 0, after = 0;
files.forEach((f) => {
  const p = path.join(dir, f);
  const w = readPcm(p);
  before += w.s.length;
  const y = sola(w.s, factor);
  after += y.length;
  writePcm(p, w.sr, w.ch, y);
});
console.log('files', files.length, 'samples', before, '->', after, 'ratio', (after / before).toFixed(3));
