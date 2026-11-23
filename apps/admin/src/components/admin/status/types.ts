/** Badge tones (components/ui/badge.tsx). */
export type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "brand";

/** Tone per enum value, per domain: `{ subscription: { ACTIVE: "success", PAST_DUE: "warning" } }`. */
export type StatusToneMap = Record<string, Record<string, StatusTone>>;
