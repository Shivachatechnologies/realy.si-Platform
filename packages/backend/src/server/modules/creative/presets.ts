/**
 * Shared (client-safe) constants of the creative production suite: image categories, platform aspect presets, styles,
 * the video pipeline's job graph and the built-in templates. No server imports.
 */

export const IMAGE_CATEGORIES = ["product", "social", "poster", "banner", "ad", "thumbnail", "infographic", "illustration", "brand"] as const;
export type ImageCategory = (typeof IMAGE_CATEGORIES)[number];

/** Category → prompt guidance appended by the prompt builder. */
export const CATEGORY_GUIDE: Record<ImageCategory, string> = {
  product: "Premium product photograph: the product is the hero, clean studio or contextual background, soft realistic shadows, accurate materials.",
  social: "Scroll-stopping social media graphic with one clear focal point and generous space for a short caption overlay.",
  poster: "Poster layout with a bold central visual, strong hierarchy and clear areas reserved for a headline and details.",
  banner: "Wide web banner composition: subject on one side, clean negative space on the other for a headline and call to action.",
  ad: "Performance ad creative: single strong benefit-driven visual, high contrast, clear area for the offer and call to action.",
  thumbnail: "Video thumbnail: expressive close-up subject, high contrast, bold shapes readable at small size, space for 2–4 large words.",
  infographic: "Clean infographic illustration: icons, simple charts and labelled sections arranged on a grid; leave text areas empty for real data.",
  illustration: "Modern editorial illustration, consistent line weight, friendly shapes, limited palette.",
  brand: "Brand asset: abstract pattern, texture or background that expresses the brand personality, usable behind text.",
};

export const IMAGE_STYLES = ["photo", "minimal", "illustration", "bold", "3d", "lifestyle", "editorial", "flat"] as const;
export type ImageStyle = (typeof IMAGE_STYLES)[number];
export const STYLE_GUIDE: Record<ImageStyle, string> = {
  photo: "Photorealistic, natural light, shallow depth of field.",
  minimal: "Minimal flat design, generous whitespace, simple geometric shapes.",
  illustration: "Vector illustration, clean lines.",
  bold: "Bold high-contrast graphic, vibrant colors, poster energy.",
  "3d": "Soft 3D render, clay materials, gentle lighting.",
  lifestyle: "Authentic lifestyle scene, candid, warm tones.",
  editorial: "Editorial magazine look, refined composition, muted sophisticated tones.",
  flat: "Flat 2D graphic, solid color fields, crisp edges.",
};

/** Platform presets: pixel size + aspect ratio (image generators get the closest supported size). */
export const PLATFORM_PRESETS = {
  instagram_square: { width: 1080, height: 1080, aspect: "1:1" },
  instagram_portrait: { width: 1080, height: 1350, aspect: "4:5" },
  story_reel: { width: 1080, height: 1920, aspect: "9:16" },
  tiktok: { width: 1080, height: 1920, aspect: "9:16" },
  youtube_thumbnail: { width: 1280, height: 720, aspect: "16:9" },
  youtube_video: { width: 1920, height: 1080, aspect: "16:9" },
  linkedin_post: { width: 1200, height: 627, aspect: "1.91:1" },
  x_post: { width: 1600, height: 900, aspect: "16:9" },
  facebook_post: { width: 1200, height: 630, aspect: "1.91:1" },
  pinterest_pin: { width: 1000, height: 1500, aspect: "2:3" },
  web_banner: { width: 1920, height: 600, aspect: "16:5" },
  leaderboard_ad: { width: 1456, height: 180, aspect: "8:1" },
  display_ad: { width: 1200, height: 1200, aspect: "1:1" },
  poster_a: { width: 1414, height: 2000, aspect: "1:1.41" },
  blog_featured: { width: 1600, height: 900, aspect: "16:9" },
} as const;
export type PlatformPreset = keyof typeof PLATFORM_PRESETS;
export const PLATFORM_PRESET_KEYS = Object.keys(PLATFORM_PRESETS) as PlatformPreset[];

/** Default preset per image category. */
export const CATEGORY_PRESET: Record<ImageCategory, PlatformPreset> = {
  product: "instagram_square",
  social: "instagram_portrait",
  poster: "poster_a",
  banner: "web_banner",
  ad: "display_ad",
  thumbnail: "youtube_thumbnail",
  infographic: "pinterest_pin",
  illustration: "blog_featured",
  brand: "instagram_square",
};

export const VIDEO_ASPECTS = ["9:16", "1:1", "16:9"] as const;
export type VideoAspect = (typeof VIDEO_ASPECTS)[number];
export const ASPECT_SIZE: Record<VideoAspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

export const PLATFORMS = ["instagram", "tiktok", "youtube", "linkedin", "facebook", "x", "pinterest", "web"] as const;
export type Platform = (typeof PLATFORMS)[number];

// ───────────── Video pipeline (job graph) ─────────────

export const PIPELINE_STEPS = [
  "idea",
  "research",
  "concept",
  "script",
  "hook",
  "storyboard",
  "scene_assets",
  "voiceover",
  "music",
  "captions",
  "assembly",
  "thumbnail",
  "variants",
  "review",
  "export",
  "handoff",
] as const;
export type PipelineStep = (typeof PIPELINE_STEPS)[number];

/** Steps that must be SUCCEEDED or SKIPPED before a step can run. */
export const STEP_DEPENDS: Record<PipelineStep, PipelineStep[]> = {
  idea: [],
  research: ["idea"],
  concept: ["research"],
  script: ["concept"],
  hook: ["script"],
  storyboard: ["hook"],
  scene_assets: ["storyboard"],
  voiceover: ["storyboard"],
  music: ["idea"],
  captions: ["voiceover"],
  assembly: ["scene_assets", "voiceover", "music", "captions"],
  thumbnail: ["storyboard"],
  variants: ["assembly"],
  review: ["assembly", "thumbnail", "variants"],
  export: ["review"],
  handoff: ["export"],
};

/** Steps a person may skip. */
export const SKIPPABLE: readonly PipelineStep[] = ["research", "hook", "voiceover", "music", "captions", "thumbnail", "variants", "handoff"];
/** Steps whose text output a person may edit. */
export const EDITABLE: readonly PipelineStep[] = ["concept", "script", "hook"];
/** Steps the worker never runs on its own (review only files the approval request; approving is always a person). */
export const MANUAL_ONLY: readonly PipelineStep[] = ["handoff"];

export const STEP_STATUSES = ["PENDING", "RUNNING", "WAITING_PROVIDER", "NEEDS_INPUT", "BLOCKED", "SUCCEEDED", "FAILED", "SKIPPED"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];
export const STEP_TONE: Record<StepStatus, "neutral" | "accent" | "info" | "warning" | "danger" | "success"> = {
  PENDING: "neutral",
  RUNNING: "accent",
  WAITING_PROVIDER: "info",
  NEEDS_INPUT: "warning",
  BLOCKED: "warning",
  SUCCEEDED: "success",
  FAILED: "danger",
  SKIPPED: "neutral",
};

// ───────────── Providers (keys in the Integrations catalog) ─────────────

export const IMAGE_STATUS_PROVIDERS = ["openai", "stability", "replicate"] as const;
export const SCENE_VIDEO_PROVIDERS = ["runway", "luma", "kling", "replicate"] as const;
export type SceneVideoProvider = (typeof SCENE_VIDEO_PROVIDERS)[number];
export const VOICE_PROVIDERS = ["elevenlabs", "openai"] as const;
export type VoiceProviderKey = (typeof VOICE_PROVIDERS)[number];
export const RENDER_PROVIDERS = ["shotstack", "creatomate"] as const;
export type RenderProviderKey = (typeof RENDER_PROVIDERS)[number];
export const MUSIC_SOURCES = ["upload", "jamendo", "epidemic_sound"] as const;
export type MusicSource = (typeof MUSIC_SOURCES)[number];

/** OpenAI TTS voices (public list). ElevenLabs voices are the account's own (voice id). */
export const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"] as const;

// ───────────── Built-in templates ─────────────

export interface BuiltinVideoTemplate {
  key: string;
  aspect: VideoAspect;
  seconds: number;
  outline: { title: string; shot: string; seconds: number }[];
}

export const VIDEO_TEMPLATES: BuiltinVideoTemplate[] = [
  {
    key: "product_teaser",
    aspect: "9:16",
    seconds: 20,
    outline: [
      { title: "Hook", shot: "Extreme close-up of the product detail, fast push-in", seconds: 3 },
      { title: "Problem", shot: "Customer frustrated with the old way, handheld medium shot", seconds: 4 },
      { title: "Reveal", shot: "Product hero shot, slow orbit, clean background", seconds: 5 },
      { title: "Benefit", shot: "Customer using the product, smiling, natural light", seconds: 5 },
      { title: "Call to action", shot: "Logo end card on brand color background", seconds: 3 },
    ],
  },
  {
    key: "explainer",
    aspect: "16:9",
    seconds: 45,
    outline: [
      { title: "Question", shot: "Bold title card on brand background", seconds: 5 },
      { title: "Context", shot: "Illustrated scene showing the situation", seconds: 10 },
      { title: "How it works", shot: "Step-by-step animated diagram", seconds: 15 },
      { title: "Proof", shot: "Calm workspace with the product in use", seconds: 10 },
      { title: "Next step", shot: "End card with call to action", seconds: 5 },
    ],
  },
  {
    key: "ugc_ad",
    aspect: "9:16",
    seconds: 15,
    outline: [
      { title: "Hook", shot: "Selfie-style talking to camera, surprised expression", seconds: 3 },
      { title: "Demo", shot: "Hands demonstrating the product, top-down", seconds: 6 },
      { title: "Result", shot: "Before/after split frame", seconds: 3 },
      { title: "Offer", shot: "Product with offer area, brand colors", seconds: 3 },
    ],
  },
  {
    key: "announcement",
    aspect: "1:1",
    seconds: 15,
    outline: [
      { title: "Teaser", shot: "Abstract brand shapes moving, light leaks", seconds: 4 },
      { title: "News", shot: "Bold title card reveal", seconds: 6 },
      { title: "Where", shot: "End card with link area", seconds: 5 },
    ],
  },
];
export const VIDEO_TEMPLATE_KEYS = VIDEO_TEMPLATES.map((t) => t.key);

/** micro-USD → display string (estimates). */
export const formatMicros = (micros: number | bigint | null | undefined): string => {
  if (micros === null || micros === undefined) return "—";
  const usd = Number(micros) / 1_000_000;
  return usd < 0.01 && usd > 0 ? "<$0.01" : `$${usd.toFixed(2)}`;
};
