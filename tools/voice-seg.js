// 分析/切分豆包 TTS 输出（RIFF WAV）：按静音间隙切段，导出为 16k 单声道 16bit 标准 PCM
const fs = require('fs');
const path = require('path');

function parseWav(buf) {
  let fmt = null, data = null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(off + 8),
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        bits: buf.readUInt16LE(off + 22)
      };
    } else if (id === 'data') {
      let sz2 = sz;
      if (sz2 <= 0 || off + 8 + sz2 > buf.length) sz2 = buf.length - off - 8; // 兼容流式写头的 0xFFFFFFFF
      data = { off: off + 8, size: sz2 };
    }
    off += 8 + sz + (sz % 2);
  }
  return { fmt, data };
}

function rmsFrames(buf, fmt, data, frameMs) {
  const ch = fmt.channels, bits = fmt.bits, sr = fmt.sampleRate;
  const bps = bits / 8;
  const frameBytes = Math.round(sr * frameMs / 1000) * ch * bps;
  const out = [];
  for (let p = data.off; p + frameBytes <= data.off + data.size; p += frameBytes) {
    let sum = 0, n = 0;
    for (let q = p; q < p + frameBytes; q += ch * bps) {
      const v = bits === 16 ? buf.readInt16LE(q) / 32768 : (buf.readUInt8(q) - 128) / 128;
      sum += v * v; n++;
    }
    out.push({ rms: Math.sqrt(sum / n), t: (p - data.off) / (sr * ch * bps) });
  }
  return out;
}

module.exports = { parseWav, rmsFrames };

if (require.main === module) {
  const file = process.argv[2];
  const buf = fs.readFileSync(file);
  const w = parseWav(buf);
  console.log('fmt', JSON.stringify(w.fmt), 'data', w.data.size, 'dur', (w.data.size / (w.fmt.channels * w.fmt.bits / 8 * w.fmt.sampleRate)).toFixed(2));
  const frames = rmsFrames(buf, w.fmt, w.data, 20);
  const thr = Number(process.argv[3] || 0.02);
  const gapMs = Number(process.argv[4] || 260);
  let segs = [], cur = null, lastLoud = 0;
  frames.forEach((f) => {
    if (f.rms > thr) {
      if (!cur) cur = { start: f.t };
      lastLoud = f.t;
    } else if (cur && (f.t - lastLoud) * 1000 > gapMs) {
      cur.end = lastLoud + 0.02;
      segs.push(cur); cur = null;
    }
  });
  if (cur) { cur.end = lastLoud + 0.02; segs.push(cur); }
  console.log('segments', segs.length);
  segs.forEach((s, i) => console.log(i, s.start.toFixed(2), s.end.toFixed(2), (s.end - s.start).toFixed(2)));
  fs.writeFileSync(path.join(path.dirname(file), 'segs.json'), JSON.stringify(segs));
}
