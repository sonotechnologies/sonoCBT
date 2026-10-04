/**
 * Small diagram PNGs for the demo's picture questions, drawn in code (no
 * image files to ship): a hexagon, a right-angled triangle and a bar chart.
 */
import { deflateSync } from "node:zlib";

type RGB = [number, number, number];
const INK: RGB = [20, 33, 61];
const FILL: RGB = [234, 241, 249];
const BG: RGB = [255, 255, 255];

class Canvas {
  px: Uint8Array;
  constructor(readonly w: number, readonly h: number) {
    this.px = new Uint8Array(w * h * 3).fill(255);
  }
  set(x: number, y: number, c: RGB) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px.set(c, (y * this.w + x) * 3);
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, c);
  }
  /** Even-odd scanline fill of a polygon, then its outline. */
  polygon(pts: [number, number][], fill: RGB, line: RGB, width = 3) {
    for (let y = 0; y < this.h; y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k]); x <= xs[k + 1]; x++) this.set(x, y, fill);
    }
    for (let i = 0; i < pts.length; i++) this.line(pts[i], pts[(i + 1) % pts.length], line, width);
  }
  line([x0, y0]: [number, number], [x1, y1]: [number, number], c: RGB, width = 3) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 0; i <= n; i++) {
      const [x, y] = [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n];
      for (let dx = -width / 2; dx <= width / 2; dx++) for (let dy = -width / 2; dy <= width / 2; dy++) this.set(x + dx, y + dy, c);
    }
  }
  png(): Uint8Array {
    const raw = new Uint8Array((this.w * 3 + 1) * this.h);
    for (let y = 0; y < this.h; y++) raw.set(this.px.subarray(y * this.w * 3, (y + 1) * this.w * 3), y * (this.w * 3 + 1) + 1);
    const chunk = (type: string, data: Uint8Array) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const td = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(td));
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
    return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]));
  }
}

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function diagram(kind: "hexagon" | "right-triangle" | "bar-chart"): Uint8Array {
  const c = new Canvas(360, 240);
  c.rect(0, 0, 360, 240, BG);
  if (kind === "hexagon") {
    const pts = Array.from({ length: 6 }, (_, i) => [180 + 95 * Math.cos((Math.PI / 3) * i), 120 + 95 * Math.sin((Math.PI / 3) * i)] as [number, number]);
    c.polygon(pts, FILL, INK);
  } else if (kind === "right-triangle") {
    c.polygon([[80, 200], [280, 200], [80, 40]], FILL, INK);
    // The right-angle mark.
    c.line([80, 180], [100, 180], INK, 2);
    c.line([100, 180], [100, 200], INK, 2);
  } else {
    const heights = [3, 5, 2, 6, 4];
    c.line([40, 210], [340, 210], INK, 3);
    c.line([40, 20], [40, 210], INK, 3);
    heights.forEach((h, i) => c.rect(60 + i * 56, 210 - h * 30, 60 + i * 56 + 36, 209, i === 1 ? [242, 183, 5] : [62, 90, 138]));
  }
  return c.png();
}
