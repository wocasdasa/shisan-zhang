// 把豆包 TTS 长音频按静音切段并导出为 16kHz 单声道 16bit 标准 PCM WAV
const fs = require('fs');
const path = require('path');
const { parseWav } = require('./voice-seg.js');

const SRC = process.argv[2];
const SEG = process.argv[3];
const OUT = process.argv[4];
const NAMES = ['k_single', 'k_pair', 'k_trio', 'k_straight', 'k_flush', 'k_fullhouse', 'k_four', 'k_straightflush',
  's_3', 's_2', 's_1', 's_0',
  'r_2', 'r_3', 'r_4', 'r_5', 'r_6', 'r_7', 'r_8', 'r_9', 'r_10', 'r_11', 'r_12', 'r_13', 'r_14'];

const TARGET_SR = 16000;
const PAD = 0.03; // 首尾各补 30ms 静音，避免起音爆点

const buf = fs.readFileSync(SRC);
const w = parseWav(buf);
const segs = JSON.parse(fs.readFileSync(SEG, 'utf8'));
if (segs.length !== NAMES.length) throw new Error('段数不符：' + segs.length + ' vs ' + NAMES.length);

fs.mkdirSync(OUT, { recursive: true });

function writeWav(file, samples) {
  const n = samples.length;
  const dataSize = n * 2;
  const out = Buffer.alloc(44 + dataSize);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + dataSize, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(TARGET_SR, 24);
  out.writeUInt32LE(TARGET_SR * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, samples[i]));
    out.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, out);
  return out.length;
}

const ch = w.fmt.channels, sr = w.fmt.sampleRate, bits = w.fmt.bits;
const bps = bits / 8;
const ratio = sr / TARGET_SR;
const total = [];
segs.forEach((s, si) => {
  const start = Math.max(0, s.start - PAD);
  const end = Math.min((w.data.size / (ch * bps * sr)), s.end + PAD);
  const nOut = Math.floor((end - start) * TARGET_SR);
  const samples = [];
  let peak = 0;
  for (let i = 0; i < nOut; i++) {
    const tSrc = start + i / TARGET_SR;
    // 线性插值（40k → 16k）
    const i0 = Math.floor(tSrc * sr);
    const frac = tSrc * sr - i0;
    const a = buf.readInt16LE(w.data.off + (i0 * ch) * bps) / 32768;
    const i1 = Math.min(i0 + 1, (w.data.size / (ch * bps)) - 1);
    const b = buf.readInt16LE(w.data.off + (i1 * ch) * bps) / 32768;
    const v = a * (1 - frac) + b * frac;
    samples.push(v);
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  // 统一峰值到 0.7，保证 25 段音量一致
  const gain = peak > 0.02 ? 0.7 / peak : 1;
  const norm = samples.map((v) => v * gain);
  const size = writeWav(path.join(OUT, NAMES[si] + '.wav'), norm);
  total.push({ name: NAMES[si], dur: +(nOut / TARGET_SR).toFixed(2), peak: +peak.toFixed(2), bytes: size });
});
console.log(JSON.stringify(total));
console.log('total bytes', total.reduce((a, b) => a + b.bytes, 0));
