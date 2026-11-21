/** Display helpers of the phone team UI (no server imports: safe in server and client components). */

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export const CALL_STATUSES = ["AWAITING_APPROVAL", "SCHEDULED", "QUEUED", "RINGING", "IN_PROGRESS", "ENDED", "FAILED", "BLOCKED", "CANCELLED", "REJECTED"] as const;
export const OUTCOMES = ["INTERESTED", "NOT_INTERESTED", "MEETING_REQUESTED", "MEETING_BOOKED", "CALLBACK_REQUESTED", "SUPPORT_ISSUE", "PAYMENT_PROMISED", "MESSAGE_TAKEN", "VOICEMAIL", "NO_ANSWER", "WRONG_NUMBER", "DO_NOT_CALL", "OTHER"] as const;
export const GOALS = ["QUALIFY_LEAD", "BOOK_MEETING", "SUPPORT_TRIAGE", "COLLECTIONS_REMINDER", "RECEPTIONIST"] as const;
export const LANGUAGES = ["en-US", "de-DE", "hi-IN", "zh-CN", "ar-AE"] as const;

export const STATUS_TONE: Record<string, Tone> = {
  AWAITING_APPROVAL: "warning",
  SCHEDULED: "info",
  QUEUED: "accent",
  RINGING: "accent",
  IN_PROGRESS: "accent",
  ENDED: "success",
  FAILED: "danger",
  BLOCKED: "danger",
  CANCELLED: "neutral",
  REJECTED: "neutral",
};

export const OUTCOME_TONE: Record<string, Tone> = {
  INTERESTED: "success",
  MEETING_REQUESTED: "success",
  MEETING_BOOKED: "success",
  PAYMENT_PROMISED: "success",
  CALLBACK_REQUESTED: "info",
  SUPPORT_ISSUE: "warning",
  MESSAGE_TAKEN: "info",
  NOT_INTERESTED: "neutral",
  VOICEMAIL: "neutral",
  NO_ANSWER: "neutral",
  WRONG_NUMBER: "neutral",
  DO_NOT_CALL: "danger",
  OTHER: "neutral",
};

export const SENTIMENT_TONE: Record<string, Tone> = { POSITIVE: "success", NEUTRAL: "neutral", NEGATIVE: "danger", UNKNOWN: "neutral" };

export const isLive = (status: string) => status === "QUEUED" || status === "RINGING" || status === "IN_PROGRESS";

/** 3:07 / 1:02:03. */
export function formatDuration(sec: number | null | undefined): string {
  if (!sec || sec < 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** +44 •••• 1234 */
export const maskPhone = (n: string | null | undefined) => (n && n.length > 6 ? `${n.slice(0, 3)} •••• ${n.slice(-4)}` : (n ?? "—"));
