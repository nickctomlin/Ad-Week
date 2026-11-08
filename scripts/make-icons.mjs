// Draws the Ad Week app icon (a white price tag on the brand green) and writes the PNG sizes phones
// need for "Add to Home Screen". No dependencies: tiny shape rasterizer + PNG encoder (node:zlib).
// Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '..', 'public', 'icons');
const GREEN_TOP = [47, 158, 102];
const GREEN_BOTTOM = [23, 98, 61];

// --- PNG encoding ---
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// --- shapes (coordinates in 0..1, origin top-left) ---
function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inRoundedSquare(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
// A price tag pointing up-left: pointed end + body, rotated 45°, with a punched hole near the point.
// Shifted slightly toward the point so the (heavier) body sits visually centered.
function tagShape(scale) {
  const body = [[-0.32, 0], [-0.15, -0.18], [0.32, -0.18], [0.32, 0.18], [-0.15, 0.18]].map(([x, y]) => [x - 0.04, y]);
  const a = (45 * Math.PI) / 180;
  const place = ([px, py]) => [0.5 + scale * (px * Math.cos(a) - py * Math.sin(a)), 0.5 + scale * (px * Math.sin(a) + py * Math.cos(a))];
  const pts = body.map(place);
  const [hx, hy] = place([-0.18, 0]);
  return { pts, hole: [hx, hy, 0.05 * scale] };
}

function draw(size, { rounded, tagScale }) {
  const img = Buffer.alloc(size * size * 4);
  const tag = tagShape(tagScale);
  const S = 4; // 4x4 supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0, white = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const u = (x + (sx + 0.5) / S) / size, v = (y + (sy + 0.5) / S) / size;
        if (rounded && !inRoundedSquare(u, v, 0.22)) continue;
        const inHole = (u - tag.hole[0]) ** 2 + (v - tag.hole[1]) ** 2 <= tag.hole[2] ** 2;
        if (inPolygon(u, v, tag.pts) && !inHole) white++; else bg++;
      }
      const t = y / size;
      const g = GREEN_TOP.map((c, i) => c + (GREEN_BOTTOM[i] - c) * t);
      const cover = (bg + white) / (S * S);
      const k = bg + white ? white / (bg + white) : 0;
      const o = (y * size + x) * 4;
      img[o] = Math.round(g[0] * (1 - k) + 255 * k);
      img[o + 1] = Math.round(g[1] * (1 - k) + 255 * k);
      img[o + 2] = Math.round(g[2] * (1 - k) + 255 * k);
      img[o + 3] = Math.round(cover * 255);
    }
  }
  return png(size, img);
}

mkdirSync(OUT, { recursive: true });
const icons = [
  ['icon-192.png', 192, { rounded: true, tagScale: 1 }],
  ['icon-512.png', 512, { rounded: true, tagScale: 1 }],
  // Maskable: full-bleed background, tag inside the central safe zone (Android crops to a circle/squircle).
  ['icon-maskable-512.png', 512, { rounded: false, tagScale: 0.78 }],
  // iOS rounds the corners itself.
  ['apple-touch-icon.png', 180, { rounded: false, tagScale: 0.9 }],
];
for (const [name, size, opts] of icons) {
  writeFileSync(join(OUT, name), draw(size, opts));
  console.log(`wrote public/icons/${name}`);
}
