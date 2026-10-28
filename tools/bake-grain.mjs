// Bakes render.js grainTexture (deterministic value noise: a 17×17 coarse
// lattice bilinearly interpolated plus fine noise, seeded, between lo and hi)
// into assets/grain-<seed>-<size>.png for the island (seed 94, 0.72–1.0) and
// the tiles (seed 7, 0.9–1.0) at the presets' sizes (128, 256): its per-pixel
// loop is far too slow for the engine's interpreter at load. Run once; the
// PNGs are committed. The bytes are the canvas's (sRGB-encoded greys, as
// CanvasTexture with SRGBColorSpace read them).
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(n, grey) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(n * (n * 3 + 1));
  for (let y = 0; y < n; y++) {
    raw[y * (n * 3 + 1)] = 0;
    for (let x = 0; x < n; x++) { const v = grey[y * n + x], o = y * (n * 3 + 1) + 1 + x * 3; raw[o] = raw[o + 1] = raw[o + 2] = v; }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function grain(seed, lo, hi, size) {
  const out = new Uint8ClampedArray(size * size);
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const coarse = [];
  for (let i = 0; i < 17 * 17; i++) coarse.push(rnd());
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = x * 16 / size, gy = y * 16 / size, ix = gx | 0, iy = gy | 0, fx = gx - ix, fy = gy - iy;
      const a = coarse[iy * 17 + ix], b = coarse[iy * 17 + ix + 1], cc = coarse[(iy + 1) * 17 + ix], d = coarse[(iy + 1) * 17 + ix + 1];
      const v = (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy;
      const n = lo + (hi - lo) * (0.65 * v + 0.35 * rnd());
      out[y * size + x] = Math.round(n * 255);
    }
  }
  return out;
}
for (const [seed, lo, hi] of [[94, 0.72, 1.0], [7, 0.9, 1.0]]) {
  for (const n of [128, 256]) writeFileSync(join(root, 'assets', `grain-${seed}-${n}.png`), png(n, grain(seed, lo, hi, n)));
}
console.log('wrote assets/grain-{94,7}-{128,256}.png');
