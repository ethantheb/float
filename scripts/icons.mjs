// Renders the extension icon (magnifying glass on a matte rounded tile) to PNGs.
// Dependency-free: shapes are drawn as signed distance fields with 4x4 supersampling.
// Usage: node scripts/icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZES = [16, 32, 48, 128];
const TILE = [28, 28, 28]; // matches the palette's dark --bg
const GLASS = [232, 232, 232]; // matches --fg

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Distance functions in unit coordinates (0..1); negative = inside.
const roundedSquare = (x, y, r) => {
  const qx = Math.abs(x - 0.5) - 0.5 + r;
  const qy = Math.abs(y - 0.5) - 0.5 + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const segment = (x, y, ax, ay, bx, by) => {
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
};

function render(size) {
  // Keep strokes at least ~1.6px wide so the 16px icon stays legible.
  const stroke = Math.max(0.085, 1.6 / size);
  const glass = (x, y) =>
    Math.min(
      Math.abs(Math.hypot(x - 0.44, y - 0.44) - 0.2) - stroke / 2,
      segment(x, y, 0.59, 0.59, 0.74, 0.74) - stroke * 0.56,
    );
  const rgba = Buffer.alloc(size * size * 4);
  const S = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let tile = 0;
      let mark = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) / size;
          const y = (py + (sy + 0.5) / S) / size;
          if (roundedSquare(x, y, 0.22) <= 0) {
            tile++;
            if (glass(x, y) <= 0) mark++;
          }
        }
      }
      const i = (py * size + px) * 4;
      const m = tile ? mark / tile : 0;
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(TILE[c] + (GLASS[c] - TILE[c]) * m);
      rgba[i + 3] = Math.round((tile / (S * S)) * 255);
    }
  }
  return png(size, rgba);
}

mkdirSync('src/icons', { recursive: true });
for (const size of SIZES) writeFileSync(`src/icons/icon${size}.png`, render(size));
console.log(`wrote src/icons/icon{${SIZES.join(',')}}.png`);
