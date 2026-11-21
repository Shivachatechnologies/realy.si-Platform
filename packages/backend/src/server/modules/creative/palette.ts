import { inflateSync } from "node:zlib";

/**
 * Minimal PNG reader (8-bit greyscale / RGB / RGBA / palette, non-interlaced — what image generators return) and
 * palette analysis for the brand-consistency check. Other formats return null (the check then says so).
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

/** Decode a PNG into sampled RGB pixels (about `samples` evenly spaced pixels). */
export function samplePng(buf: Buffer, samples = 6000): Rgb[] | null {
  if (buf.length < 33 || SIG.some((v, i) => buf[i] !== v)) return null;
  let off = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let plte: Buffer | null = null;
  const idat: Buffer[] = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === "PLTE") plte = Buffer.from(data);
    else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (!width || !height || depth !== 8 || interlace !== 0 || width * height > 40_000_000) return null;
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (!channels || (colorType === 3 && !plte)) return null;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[dst + x - channels]! : 0;
      const b = y > 0 ? out[dst - stride + x]! : 0;
      const c = x >= channels && y > 0 ? out[dst - stride + x - channels]! : 0;
      const v = raw[src + x]!;
      let r: number;
      if (filter === 0) r = v;
      else if (filter === 1) r = v + a;
      else if (filter === 2) r = v + b;
      else if (filter === 3) r = v + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[dst + x] = r & 0xff;
    }
  }
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / samples)));
  const pixels: Rgb[] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = y * stride + x * channels;
      if (colorType === 6 && out[i + 3]! < 32) continue;
      if (colorType === 4 && out[i + 1]! < 32) continue;
      if (colorType === 0 || colorType === 4) pixels.push({ r: out[i]!, g: out[i]!, b: out[i]! });
      else if (colorType === 3) {
        const pi = out[i]! * 3;
        pixels.push({ r: plte![pi] ?? 0, g: plte![pi + 1] ?? 0, b: plte![pi + 2] ?? 0 });
      } else pixels.push({ r: out[i]!, g: out[i + 1]!, b: out[i + 2]! });
    }
  }
  return pixels;
}

export const hexToRgb = (hex: string): Rgb => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) });
export const rgbToHex = (c: Rgb) => `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** Perceptual-ish distance ("redmean" weighted RGB), 0 … ~765. */
export function colorDistance(a: Rgb, b: Rgb): number {
  const rm = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

/** Dominant colors by 4-bit-per-channel buckets (share of sampled pixels). */
export function dominantColors(pixels: Rgb[], top = 6): { hex: string; share: number }[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const p of pixels) {
    const k = ((p.r >> 4) << 8) | ((p.g >> 4) << 4) | (p.b >> 4);
    const e = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += p.r;
    e.g += p.g;
    e.b += p.b;
    buckets.set(k, e);
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, top)
    .map((e) => ({ hex: rgbToHex({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n }), share: Number((e.n / Math.max(1, pixels.length)).toFixed(3)) }));
}

/** Neutral pixels (near white/black/grey) are ignored when measuring brand-color coverage. */
const isNeutral = (p: Rgb) => Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b) < 18;

export interface PaletteReport {
  dominant: { hex: string; share: number }[];
  /** Share of non-neutral pixels close to a brand color (0…1). */
  brandCoverage: number;
  /** Per brand color: share of non-neutral pixels nearest to it within tolerance. */
  perColor: { name: string; hex: string; share: number }[];
  /** Dominant non-neutral colors that are far from every brand color. */
  offPalette: string[];
}

export function paletteReport(pixels: Rgb[], brand: { name: string; hex: string }[], tolerance = 90): PaletteReport {
  const colors = brand.map((c) => ({ ...c, rgb: hexToRgb(c.hex) }));
  const vivid = pixels.filter((p) => !isNeutral(p));
  const counts = new Array(colors.length).fill(0) as number[];
  let near = 0;
  for (const p of vivid) {
    let best = -1;
    let bestD = Infinity;
    colors.forEach((c, i) => {
      const d = colorDistance(p, c.rgb);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0 && bestD <= tolerance) {
      near++;
      counts[best]!++;
    }
  }
  const dominant = dominantColors(pixels);
  const offPalette = dominant.filter((d) => d.share >= 0.05 && !isNeutral(hexToRgb(d.hex)) && colors.every((c) => colorDistance(hexToRgb(d.hex), c.rgb) > tolerance)).map((d) => d.hex);
  return {
    dominant,
    brandCoverage: vivid.length ? Number((near / vivid.length).toFixed(3)) : 1,
    perColor: colors.map((c, i) => ({ name: c.name, hex: c.hex, share: vivid.length ? Number((counts[i]! / vivid.length).toFixed(3)) : 0 })),
    offPalette,
  };
}
