/**
 * Resolve any CSS colour (including oklch() and var()-based tokens) to sRGB for canvas/WebGL, by painting one pixel.
 * Results are cached per string. Returns [r, g, b] in 0–255.
 */
const cache = new Map<string, [number, number, number]>();
let ctx: CanvasRenderingContext2D | null = null;

export function toRgb(color: string): [number, number, number] {
  const hit = cache.get(color);
  if (hit) return hit;
  if (typeof document === "undefined") return [128, 128, 160];
  ctx ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return [128, 128, 160];
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#808080";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  const rgb: [number, number, number] = [d[0]!, d[1]!, d[2]!];
  cache.set(color, rgb);
  return rgb;
}

/** Read CSS custom properties as resolved colours from an element (e.g. "--world-accent"). */
export function readTokens<K extends string>(el: Element, names: Record<K, string>): Record<K, [number, number, number]> {
  const cs = getComputedStyle(el);
  const out = {} as Record<K, [number, number, number]>;
  for (const k of Object.keys(names) as K[]) {
    const raw = cs.getPropertyValue(names[k]).trim();
    out[k] = toRgb(raw || "#8080a0");
  }
  return out;
}

export const rgba = ([r, g, b]: [number, number, number], a: number) => `rgba(${r},${g},${b},${a})`;

/** Re-read tokens when the theme flips (OS scheme or data-theme). */
export function onThemeChange(cb: () => void): () => void {
  const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
  mql?.addEventListener("change", cb);
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
  return () => {
    mql?.removeEventListener("change", cb);
    mo.disconnect();
  };
}

/** Deterministic 32-bit hash (FNV-1a) for seeds. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The world's two accents (falling back to the brand primaries outside a <World>) plus foreground/muted ink. */
export function accentColors(el: Element) {
  const cs = getComputedStyle(el);
  const pick = (a: string, b: string) => toRgb(cs.getPropertyValue(a).trim() || cs.getPropertyValue(b).trim() || "#7070f0");
  return {
    a: pick("--world-accent", "--primary"),
    b: pick("--world-accent-2", "--primary-2"),
    fg: pick("--foreground", "--foreground"),
    muted: pick("--muted-foreground", "--muted-foreground"),
    surface: pick("--surface", "--surface"),
    success: pick("--success", "--success"),
    warning: pick("--warning", "--warning"),
    info: pick("--info", "--info"),
    danger: pick("--danger", "--danger"),
  };
}
export type Palette = ReturnType<typeof accentColors>;
