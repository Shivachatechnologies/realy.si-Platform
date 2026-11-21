/**
 * Voice OS catalog — pure data, no imports: safe for client components (the Realy console and dock) and the server.
 */

export const VOICE_LANGUAGES = ["en-US", "de-DE", "ar-AE", "hi-IN", "zh-CN"] as const;
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number];
export const isVoiceLanguage = (v: unknown): v is VoiceLanguage => typeof v === "string" && (VOICE_LANGUAGES as readonly string[]).includes(v);

/** ISO-639-1 code sent to transcription providers. */
export const STT_LANGUAGE: Record<VoiceLanguage, string> = { "en-US": "en", "de-DE": "de", "ar-AE": "ar", "hi-IN": "hi", "zh-CN": "zh" };

export const STT_PROVIDERS = ["openai", "elevenlabs", "deepgram"] as const;
export const TTS_PROVIDERS = ["elevenlabs", "openai"] as const;
export type SttProvider = (typeof STT_PROVIDERS)[number];
export type TtsProvider = (typeof TTS_PROVIDERS)[number];
export const STT_CHOICES = ["auto", ...STT_PROVIDERS, "browser"] as const;
export const TTS_CHOICES = ["auto", ...TTS_PROVIDERS, "browser"] as const;
export type SttChoice = (typeof STT_CHOICES)[number];
export type TtsChoice = (typeof TTS_CHOICES)[number];

export interface Personality {
  key: string;
  /** OpenAI gpt-4o-mini-tts voice and speaking-style instructions. */
  openaiVoice: string;
  openaiStyle: string;
  /** ElevenLabs premade voice id (overridable per connection with config.voiceId). */
  elevenVoiceId: string;
  /** Browser speechSynthesis rate / pitch (fallback voice). */
  rate: number;
  pitch: number;
  /** Prefer a female/male system voice in the browser fallback when the OS offers both. */
  browserGender: "female" | "male";
}

/** Voice personalities (labels: jarvis.personalities.<key>.*). */
export const PERSONALITIES: Personality[] = [
  { key: "aria", openaiVoice: "coral", openaiStyle: "Warm, composed and clear. Speak like a trusted chief of staff: calm pace, friendly, confident.", elevenVoiceId: "21m00Tcm4TlvDq8ikWAM", rate: 1, pitch: 1, browserGender: "female" },
  { key: "atlas", openaiVoice: "onyx", openaiStyle: "Deep, calm and executive. Measured pace, short sentences, reassuring authority.", elevenVoiceId: "pNInz6obpgDQGcFmaJgB", rate: 0.95, pitch: 0.85, browserGender: "male" },
  { key: "nova", openaiVoice: "nova", openaiStyle: "Bright, energetic and upbeat. Quick pace with enthusiasm, but always clear.", elevenVoiceId: "XB0fDUnXU5powFXDhCwa", rate: 1.08, pitch: 1.1, browserGender: "female" },
  { key: "sage", openaiVoice: "sage", openaiStyle: "Precise and analytical. Neutral tone, crisp delivery, numbers spoken carefully.", elevenVoiceId: "onwK4e9ZLuTAKqWW03F9", rate: 1, pitch: 0.95, browserGender: "male" },
];
export const personalityOf = (key: string | null | undefined): Personality => PERSONALITIES.find((p) => p.key === key) ?? PERSONALITIES[0]!;

/**
 * Wake phrases per language (lower-case, matched inside the browser recogniser's transcript). Browsers often hear
 * "Realy" as "really"/"riley", so near-homophones are accepted.
 */
export const WAKE_PHRASES: Record<VoiceLanguage, string[]> = {
  "en-US": ["hey realy", "hey really", "hey riley", "hey reali", "hey raleigh", "hi realy", "hi really"],
  "de-DE": ["hey realy", "hey really", "hallo realy", "hallo really", "hey reali"],
  "ar-AE": ["هاي ريلي", "مرحبا ريلي", "يا ريلي", "hey realy", "hey really"],
  "hi-IN": ["हे रियली", "हाय रियली", "hey realy", "hey really"],
  "zh-CN": ["嘿 realy", "嘿realy", "嘿 really", "嘿really", "你好 realy", "嘿瑞利", "嘿 瑞利", "hey realy", "hey really"],
};

/** Words that confirm / reject a pending approval (whole short utterance only; see voiceos/service.ts). */
export const CONFIRM_WORDS: Record<VoiceLanguage, { yes: string[]; no: string[] }> = {
  "en-US": { yes: ["approve", "approved", "confirm", "confirmed", "yes", "yes do it", "go ahead", "do it"], no: ["reject", "rejected", "decline", "no", "don't", "do not", "cancel"] },
  "de-DE": { yes: ["genehmigen", "genehmigt", "bestätigen", "bestätigt", "ja", "ja mach das", "freigeben", "mach es"], no: ["ablehnen", "abgelehnt", "nein", "abbrechen", "nicht"] },
  "ar-AE": { yes: ["موافق", "أوافق", "وافق", "نعم", "تأكيد", "أكد", "نفذ"], no: ["رفض", "أرفض", "ارفض", "لا", "إلغاء", "الغ"] },
  "hi-IN": { yes: ["मंज़ूर", "मंजूर", "स्वीकार", "हाँ", "हां", "पुष्टि", "कर दो"], no: ["अस्वीकार", "नहीं", "रद्द", "मत करो"] },
  "zh-CN": { yes: ["批准", "同意", "确认", "是的", "是", "好的", "执行"], no: ["拒绝", "不同意", "不", "取消", "不要"] },
};

/** Spoken control words handled locally by the client (stop speaking / cancel listening). */
export const STOP_WORDS: Record<VoiceLanguage, string[]> = {
  "en-US": ["stop", "be quiet", "quiet", "mute", "silence"],
  "de-DE": ["stopp", "stop", "ruhe", "leise", "halt"],
  "ar-AE": ["توقف", "اسكت", "قف"],
  "hi-IN": ["रुको", "बस", "चुप"],
  "zh-CN": ["停", "停止", "安静"],
};

/** Departments lit on the AI Core (labels: jarvis.departments.<key>). */
export const DEPARTMENTS = ["sales", "marketing", "finance", "people", "operations", "support", "ai", "comms"] as const;
export type Department = (typeof DEPARTMENTS)[number];

/** Domain event type (or prefix) → department, and the read permission a viewer needs to see it on the stream. */
const EVENT_RULES: [RegExp, Department, string][] = [
  [/^(lead|deal|customer|contact|crm)\./, "sales", "sales.read"],
  [/^(invoice|expense|payment)\./, "finance", "finance.read"],
  [/^(task|project)\./, "operations", "projects.read"],
  [/^(employee|candidate|leave)\./, "people", "hr.read"],
  [/^(campaign|content|marketing|site|form)\./, "marketing", "marketing.read"],
  [/^(ticket|livechat)\./, "support", "support.read"],
  [/^(meeting|announcement|voice|briefing)\./, "comms", "communication.read"],
  [/^(agent|autonomy)\./, "ai", "agents.read"],
  [/^approval\./, "ai", "approvals.read"],
  [/^(objective|milestone)\./, "operations", "objectives.read"],
  [/^(integration|webhook)\./, "operations", "integrations.read"],
];
/** Events never shown on the live stream (internal ticks, platform-level rows). */
export const HIDDEN_EVENT_TYPES = ["schedule.tick"];

export function eventRule(type: string): { department: Department; permission: string } | null {
  if (HIDDEN_EVENT_TYPES.includes(type)) return null;
  const hit = EVENT_RULES.find(([re]) => re.test(type));
  return hit ? { department: hit[1], permission: hit[2] } : null;
}

/** Agent profile → department (for nodes lit by agent task state changes). */
export function profileDepartment(profile: string): Department {
  if (/(sdr|account_executive|sales|voice_caller|prospect)/.test(profile)) return "sales";
  if (/(cmo|content|seo|marketing|social|brand)/.test(profile)) return "marketing";
  if (/(cfo|finance|bookkeep|account)/.test(profile)) return "finance";
  if (/(recruit|people|hr)/.test(profile)) return "people";
  if (/(support|receptionist)/.test(profile)) return "support";
  if (/(project|operations|automation|product)/.test(profile)) return "operations";
  return "ai";
}

/** Events that turn the core to ALERT / SUCCESS for a moment (real outcomes only). */
export const ALERT_EVENTS = ["approval.requested", "agent.task.failed", "invoice.overdue", "autonomy.demoted", "deal.lost"];
export const SUCCESS_EVENTS = ["deal.won", "invoice.paid", "payment.received", "candidate.hired", "agent.task.completed", "ticket.resolved", "marketing.run_completed", "voice.call_completed", "site.published"];

/** Longest single recording accepted for transcription. */
export const MAX_UTTERANCE_SECONDS = 120;
/** Longest text voiced in one TTS request. */
export const MAX_SPEAK_CHARS = 1200;
