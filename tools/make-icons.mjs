/* Generates the app icons with no dependencies:  node tools/make-icons.mjs

   The mark is the Day Dial: a 270° gauge, two-thirds filled. To use your
   own artwork instead, replace the PNGs in app/icons/ (same names and
   sizes) and delete this script. */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../app/icons/', import.meta.url));
mkdirSync(OUT, { recursive: true });

/* ── minimal PNG encoder ── */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xFFFFFFFF; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ── the mark, as signed-distance shapes sampled per pixel ── */
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const BG0 = hex('#13202A'), BG1 = hex('#070A0D'), GOLD = hex('#2BD4F0'), TRACK = hex('#3A3D45'), WHITE = [255, 255, 255];

/** distance to an arc of radius R from angle a0 to a1 (radians, clockwise from +x, y down), with round caps */
function arcDist(x, y, R, a0, a1) {
  let a = Math.atan2(y, x); while (a < a0) a += Math.PI * 2;
  if (a <= a1) return Math.abs(Math.hypot(x, y) - R);
  const d0 = Math.hypot(x - R * Math.cos(a0), y - R * Math.sin(a0)), d1 = Math.hypot(x - R * Math.cos(a1), y - R * Math.sin(a1));
  return Math.min(d0, d1);
}
function roundRectDist(x, y, half, r) { const qx = Math.abs(x) - (half - r), qy = Math.abs(y) - (half - r); return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; }

function render(size, { corner = 0.22, scale = 1, silhouette = false }) {
  const SS = 4, buf = Buffer.alloc(size * size * 4);
  const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25, FILL = A0 + (A1 - A0) * 0.66;
  const R = 0.275 * scale, TH = 0.082 * scale, DOT = 0.062 * scale;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, al = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const x = (px + (sx + 0.5) / SS) / size - 0.5, y = (py + (sy + 0.5) / SS) / size - 0.5;
      let col = null, alpha = 0;
      const inBg = silhouette ? false : (corner === 0 ? true : roundRectDist(x, y, 0.5, corner) <= 0);
      if (inBg) { col = mix(BG0, BG1, Math.min(1, Math.hypot(x + 0.25, y + 0.3) * 1.25)); alpha = 1; }
      const yy = y + 0.02 * scale;                                   // optical centring: the gauge opens downward
      if (arcDist(x, yy, R, A0, A1) <= TH / 2) { col = silhouette ? WHITE : TRACK; alpha = 1; }
      if (arcDist(x, yy, R, A0, FILL) <= TH / 2) { col = silhouette ? WHITE : GOLD; alpha = 1; }
      if (!silhouette && Math.hypot(x, yy) <= DOT) { col = GOLD; alpha = 1; }
      if (alpha) { r += col[0]; g += col[1]; b += col[2]; al += 1; }
    }
    const n = SS * SS, i = (py * size + px) * 4;
    if (al) { buf[i] = Math.round(r / al); buf[i + 1] = Math.round(g / al); buf[i + 2] = Math.round(b / al); }
    buf[i + 3] = Math.round(al / n * 255);
  }
  return png(size, buf);
}

const files = {
  'icon-192.png': render(192, {}),
  'icon-512.png': render(512, {}),
  'icon-maskable-512.png': render(512, { corner: 0, scale: 0.8 }),     // full bleed, mark inside the safe zone
  'apple-touch-icon.png': render(180, { corner: 0, scale: 0.92 }),      // iOS applies its own mask
  'badge-96.png': render(96, { silhouette: true, scale: 1.25 })         // Android draws badges from the alpha channel only
};
for (const [name, data] of Object.entries(files)) { writeFileSync(OUT + name, data); console.log(name, data.length + ' bytes'); }

writeFileSync(OUT + 'icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#080A0D"/>
  <path d="M19.55 45.73A17.6 17.6 0 1 1 44.45 45.73" fill="none" stroke="#3A3D45" stroke-width="5.2" stroke-linecap="round"/>
  <path d="M19.55 45.73A17.6 17.6 0 0 1 46.9 23.9" fill="none" stroke="#2BD4F0" stroke-width="5.2" stroke-linecap="round"/>
  <circle cx="32" cy="33.3" r="4" fill="#2BD4F0"/>
</svg>
`);
console.log('icon.svg');
