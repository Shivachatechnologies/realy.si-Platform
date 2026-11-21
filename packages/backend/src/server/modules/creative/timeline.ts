/**
 * Pure helpers of the video pipeline: caption cues from word timings (SRT / WebVTT) and the editable edit timeline
 * (JSON + CMX3600-style EDL) built from storyboard scenes, voiceover and music. No server imports.
 */

export interface Word {
  text: string;
  start: number;
  end: number;
}
export interface Cue {
  index: number;
  start: number;
  end: number;
  text: string;
}

/** Group words into readable caption cues (≤ maxChars, ≤ maxSeconds, break after sentence punctuation). */
export function cuesFromWords(words: Word[], opts: { maxChars?: number; maxSeconds?: number } = {}): Cue[] {
  const maxChars = opts.maxChars ?? 42;
  const maxSeconds = opts.maxSeconds ?? 3.2;
  const cues: Cue[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    cues.push({ index: cues.length + 1, start: cur[0]!.start, end: Math.max(cur[cur.length - 1]!.end, cur[0]!.start + 0.4), text: cur.map((w) => w.text).join(" ") });
    cur = [];
  };
  for (const w of words) {
    const text = [...cur.map((c) => c.text), w.text].join(" ");
    if (cur.length && (text.length > maxChars || w.end - cur[0]!.start > maxSeconds)) flush();
    cur.push(w);
    if (/[.!?;:]$/.test(w.text)) flush();
  }
  flush();
  return cues;
}

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, "0");
function stamp(seconds: number, sep: "," | "."): string {
  const s = Math.max(0, seconds);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  const total = Math.floor(s) + (ms === 1000 ? 1 : 0);
  return `${pad(total / 3600)}:${pad((total % 3600) / 60)}:${pad(total % 60)}${sep}${pad(ms === 1000 ? 0 : ms, 3)}`;
}

export const toSrt = (cues: Cue[]) => cues.map((c) => `${c.index}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.text}\n`).join("\n");
export const toVtt = (cues: Cue[]) => `WEBVTT\n\n${cues.map((c) => `${c.index}\n${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.text}\n`).join("\n")}`;

// ───────────── Edit timeline ─────────────

export interface TimelineScene {
  position: number;
  title: string;
  seconds: number;
  media: "image" | "video";
  /** Library asset (MarketingAsset id) and its public URL, when generated. */
  assetId: string | null;
  url: string | null;
  narration: string;
  onScreenText: string | null;
}

export interface EditTimeline {
  version: 1;
  aspect: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  tracks: {
    video: { scene: number; title: string; media: "image" | "video"; assetId: string | null; src: string | null; start: number; length: number; motion: string | null; text: string | null }[];
    voiceover: { assetId: string | null; src: string | null; start: number; length: number } | null;
    music: { assetId: string | null; src: string | null; start: number; length: number; volume: number; license: string | null } | null;
    captions: Cue[];
  };
  missing: string[];
}

/**
 * Lay scenes end-to-end. When a voiceover exists and is longer/shorter than the storyboard, scene lengths are scaled
 * proportionally so picture and narration end together.
 */
export function buildTimeline(input: {
  aspect: string;
  width: number;
  height: number;
  scenes: TimelineScene[];
  voiceover?: { assetId: string | null; src: string | null; duration: number } | null;
  music?: { assetId: string | null; src: string | null; license: string | null } | null;
  cues?: Cue[];
}): EditTimeline {
  const scenes = [...input.scenes].sort((a, b) => a.position - b.position);
  const planned = scenes.reduce((s, x) => s + Math.max(0.5, x.seconds), 0) || 1;
  const target = input.voiceover?.duration && input.voiceover.duration > 0 ? input.voiceover.duration + 0.6 : planned;
  const scale = target / planned;
  let t = 0;
  const video = scenes.map((s) => {
    const length = Number((Math.max(0.5, s.seconds) * scale).toFixed(3));
    const clip = { scene: s.position, title: s.title, media: s.media, assetId: s.assetId, src: s.url, start: Number(t.toFixed(3)), length, motion: s.media === "image" ? "ken_burns_in" : null, text: s.onScreenText };
    t += length;
    return clip;
  });
  const duration = Number(t.toFixed(3));
  const missing = video.filter((v) => !v.src).map((v) => `scene ${v.scene}`);
  return {
    version: 1,
    aspect: input.aspect,
    width: input.width,
    height: input.height,
    fps: 30,
    duration,
    tracks: {
      video,
      voiceover: input.voiceover ? { assetId: input.voiceover.assetId, src: input.voiceover.src, start: 0, length: Number(input.voiceover.duration.toFixed(3)) } : null,
      music: input.music ? { assetId: input.music.assetId, src: input.music.src, start: 0, length: duration, volume: 0.25, license: input.music.license } : null,
      captions: input.cues ?? [],
    },
    missing,
  };
}

/** CMX3600-style EDL of the picture track (for import into Premiere, Resolve, Final Cut via converters). */
export function toEdl(tl: EditTimeline, title: string): string {
  const fps = tl.fps;
  const tc = (sec: number) => {
    const f = Math.round(sec * fps);
    return `${pad(f / (3600 * fps))}:${pad((f / (60 * fps)) % 60)}:${pad((f / fps) % 60)}:${pad(f % fps)}`;
  };
  const lines = [`TITLE: ${title.replace(/[\r\n]+/g, " ").slice(0, 70)}`, "FCM: NON-DROP FRAME", ""];
  tl.tracks.video.forEach((c, i) => {
    const reel = `S${String(c.scene).padStart(3, "0")}`;
    lines.push(`${String(i + 1).padStart(3, "0")}  ${reel.padEnd(8)} V     C        ${tc(0)} ${tc(c.length)} ${tc(c.start)} ${tc(c.start + c.length)}`);
    lines.push(`* FROM CLIP NAME: ${c.title.replace(/[\r\n]+/g, " ").slice(0, 60)}`);
    if (c.src) lines.push(`* SOURCE: ${c.src}`);
    lines.push("");
  });
  return lines.join("\n");
}
