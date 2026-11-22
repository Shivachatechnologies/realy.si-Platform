/**
 * Voice OS intent routing — pure helpers (no I/O), shared by the server conversation path (voiceos/converse.ts) and
 * unit tests. Every utterance is one of:
 *  - "conversation": small talk, greetings, thanks, questions about Realy itself;
 *  - "company_question": a question about the company's current state (tasks, approvals, sales, today's work…);
 *  - "work_request": a request for work or an action (write, send, create, plan…), handed to AI employees.
 * The model classifier (converse.ts) decides when AI is configured; these heuristics are its fallback.
 */

/** Routing / platform-control key of the Voice OS assistant (Admin → AI can disable it like any AI role). */
export const VOICE_PROFILE = "voice_assistant";
/** Usage rows (agent_tasks) of the assistant are linked to the voice session with this subject type. */
export const VOICE_SUBJECT = "voiceos_session";

export const VOICE_INTENTS = ["conversation", "company_question", "work_request"] as const;
export type VoiceIntent = (typeof VOICE_INTENTS)[number];
export const isVoiceIntent = (v: unknown): v is VoiceIntent => typeof v === "string" && (VOICE_INTENTS as readonly string[]).includes(v);

const fold = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/[.,!?;:"'“”‘’()。，！？؟،।]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;

/** Leading wake phrase ("hey Realy", "hi really", "हे रियली"…), removed before routing. */
const WAKE_RE = /^\s*(?:(?:hey|hi|hello|hallo|ok|okay|हे|हाय|嘿|你好|هاي|مرحبا|يا)\s*,?\s*)?(?:realy|really|riley|reali|raleigh|रियली|瑞利|ريلي)\b[\s,.!:;-]*/i;
export function stripWake(text: string): string {
  const out = text.replace(WAKE_RE, "").trim();
  return out || text.trim();
}

/** Words asking for work (imperatives in English, Hinglish, German, Hindi, Arabic, Chinese). */
const WORK_WORDS = [
  // English
  "write", "draft", "create", "make", "send", "prepare", "schedule", "launch", "publish", "post ", "generate", "build", "design", "plan ", "organize", "organise", "set up", "setup", "book", "invite", "email ", "call ", "follow up", "update ", "add ", "assign", "hire", "research", "analyze", "analyse", "translate", "summarize", "summarise", "remind",
  // Hinglish (romanised Hindi)
  "likho", "likh do", "likhdo", "bhejo", "bhej do", "bhejdo", "banao", "bana do", "banado", "taiyar karo", "tayyar karo", "karo", "kar do", "kardo", "shuru karo", "schedule karo", "post karo", "dhundo", "dhoondo", "bulao",
  // German
  "schreib", "erstell", "sende", "schick", "plane ", "bereite", "veröffentlich", "buche", "lade ",
  // Hindi
  "लिखो", "लिख दो", "भेजो", "भेज दो", "बनाओ", "बना दो", "तैयार करो", "करो", "कर दो", "शुरू करो",
  // Arabic
  "اكتب", "أرسل", "ارسل", "أنشئ", "انشئ", "جهز", "حضر", "خطط", "انشر",
  // Chinese
  "写", "发送", "创建", "制作", "准备", "安排", "发布", "起草", "生成",
];

/** Words asking about the state of things. */
const QUESTION_WORDS = [
  // English
  "how ", "what ", "what's", "whats", "which ", "who ", "when ", "where ", "why ", "is there", "are there", "do we", "did we", "any ", "status", "pending", "overview", "update me", "tell me", "show me",
  // Hinglish
  "kaisa", "kaise", "kaisi", "kya ", "kitne", "kitna", "kitni", "kab ", "kaun", "kahan", "kyun", "kyon", "batao", "bata do", "haal", "chal raha", "chal rahe", "hai kya", "hain kya",
  // German
  "wie ", "was ", "welche", "wer ", "wann ", "warum", "gibt es", "stand ", "status",
  // Hindi
  "कैसा", "कैसे", "क्या", "कितने", "कितना", "कितनी", "कब", "कौन", "बताओ", "हाल",
  // Arabic
  "كيف", "ماذا", "ما ", "كم ", "هل ", "متى", "أين",
  // Chinese
  "怎么样", "怎么", "多少", "什么", "哪些", "吗", "情况", "状态",
];

/** Words of the company's state (what a status question is about). */
const STATE_WORDS = [
  "task", "approval", "sales", "revenue", "invoice", "deal", "lead", "pipeline", "cash", "objective", "goal", "meeting", "today", "this week", "everything", "company", "business", "team", "ticket", "campaign", "pending", "running", "queued", "failed", "kaam", "aaj", "sab", "sabkuch", "sab kuch", "bikri",
  "aufgabe", "freigabe", "umsatz", "heute", "alles", "firma",
  "काम", "मंज़ूरी", "मंजूरी", "बिक्री", "आज", "सब",
  "مهام", "موافق", "مبيعات", "اليوم", "الشركة",
  "任务", "审批", "销售", "今天", "公司", "一切",
];

/** Greetings, thanks and pleasantries. */
const CHAT_WORDS = [
  "hi", "hello", "hey", "thanks", "thank you", "thx", "good morning", "good evening", "good night", "how are you", "who are you", "what can you do", "bye", "nice", "great", "cool", "ok", "okay",
  "namaste", "namaskar", "shukriya", "dhanyavad", "aap kaise", "tum kaise", "kya haal", "theek", "accha", "acha",
  "hallo", "danke", "guten morgen", "guten tag", "wie geht",
  "नमस्ते", "धन्यवाद", "शुक्रिया", "आप कैसे",
  "مرحبا", "شكرا", "صباح الخير", "كيف حالك",
  "你好", "谢谢", "早上好", "你是谁",
];

const has = (folded: string, words: readonly string[]) => words.some((w) => folded.includes(w.endsWith(" ") ? ` ${w}` : w.length <= 3 && /^[a-z]+$/.test(w) ? ` ${w} ` : w));

/** Deterministic fallback classification (used when AI is not configured or the classifier call fails). */
export function heuristicIntent(raw: string): VoiceIntent {
  const text = stripWake(raw);
  const f = fold(text);
  const words = f.trim().split(" ").filter(Boolean);
  const question = /[?？؟]/.test(text) || has(f, QUESTION_WORDS);
  const work = has(f, WORK_WORDS);
  const state = has(f, STATE_WORDS);
  const chat = has(f, CHAT_WORDS);
  // "how do I write…?" / "what should I post?" are questions, not orders; an order without a question is work.
  if (work && !question) return "work_request";
  if (question && state) return "company_question";
  if (work && question && !chat && words.length > 4 && !/^\s*(how|what|why|kaise|kya|wie|was)\b/.test(f)) return "work_request";
  if (chat || words.length <= 3) return "conversation";
  if (question) return "company_question";
  return "work_request";
}

// ───────────── Reply language ─────────────

/** Romanised Hindi markers (Hinglish detection). */
const HINGLISH = ["hai", "hain", "kya", "kaisa", "kaise", "kaisi", "kitne", "kitna", "kitni", "sab", "mujhe", "mera", "meri", "aap", "tum", "karo", "kar", "likho", "bhejo", "banao", "batao", "nahi", "nahin", "abhi", "aaj", "kal", "kuch", "bhi", "ho", "raha", "rahe", "rahi", "wala", "wali", "ek", "aur", "ki", "ka", "ke", "ko", "se", "par", "theek", "accha", "acha", "yaar", "bhai", "chal", "kaam", "haal", "pending hain"];

export interface ReplyLanguage {
  /** BCP-47-ish code for speech (hi-IN for Hindi and Hinglish). */
  code: string;
  /** Instruction for the model, e.g. "Hinglish (Hindi in Latin script, mixed with English)". */
  label: string;
}

const LABELS: Record<string, string> = {
  "en-US": "English",
  "de-DE": "German",
  "ar-AE": "Arabic",
  "hi-IN": "Hindi (Devanagari script)",
  "zh-CN": "Simplified Chinese",
};

/**
 * The language to answer in: the script and words of the utterance first (Devanagari → Hindi, romanised Hindi →
 * Hinglish, Arabic, Chinese, German markers), else the session / UI locale.
 */
export function replyLanguage(raw: string, sessionLanguage: string): ReplyLanguage {
  const text = stripWake(raw);
  if (/[ऀ-ॿ]/.test(text)) return { code: "hi-IN", label: LABELS["hi-IN"]! };
  if (/[؀-ۿ]/.test(text)) return { code: "ar-AE", label: LABELS["ar-AE"]! };
  if (/[一-鿿]/.test(text)) return { code: "zh-CN", label: LABELS["zh-CN"]! };
  const words = fold(text).trim().split(" ").filter(Boolean);
  const hindi = words.filter((w) => HINGLISH.includes(w)).length;
  if (words.length && hindi >= Math.max(1, Math.ceil(words.length * 0.25))) return { code: "hi-IN", label: "Hinglish (Hindi written in Latin script, mixed with English words, the way the user wrote it)" };
  if (/[äöüß]/i.test(text) || /\b(wie|was|ist|sind|bitte|heute|alles|und|nicht)\b/i.test(text)) return { code: "de-DE", label: LABELS["de-DE"]! };
  if (/^[\x00-\x7F\s]*$/.test(text) && words.length >= 3 && sessionLanguage !== "en-US") return { code: "en-US", label: LABELS["en-US"]! };
  return { code: sessionLanguage, label: LABELS[sessionLanguage] ?? "English" };
}

// ───────────── Dispatch honesty ─────────────

export type WorkerState = "ok" | "stale" | "missing" | "not_configured";

/**
 * Reply key for a dispatched command (jarvis.reply.*): with no live background worker the work is only queued, and
 * the reply must say so instead of promising a result.
 */
export function dispatchReplyKey(outcome: "delegated" | "blocked" | "planned" | "failed", worker: WorkerState): string {
  if (outcome !== "delegated" && outcome !== "planned") return outcome;
  if (worker === "ok") return outcome;
  return worker === "not_configured" ? "queuedNoWorkerSetup" : "queuedWorkerDown";
}
