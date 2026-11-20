import type { Translate } from "@/i18n/translate";
import type { FieldOption } from "./hr-form";

/** Localized select options for an enum: label key `${prefix}.${value}`. */
export const enumOptions = (t: Translate, prefix: string, values: readonly string[]): FieldOption[] => values.map((v) => ({ value: v, label: t(`${prefix}.${v}`) }));

export const peopleOptions = (people: { id: string; firstName: string; lastName: string | null; title?: string | null }[]): FieldOption[] =>
  people.map((p) => ({ value: p.id, label: [[p.firstName, p.lastName].filter(Boolean).join(" "), p.title].filter(Boolean).join(" — ") }));

export const namedOptions = (rows: { id: string; name: string }[]): FieldOption[] => rows.map((r) => ({ value: r.id, label: r.name }));

/** Monday (UTC) of the week containing `d`, as YYYY-MM-DD. */
export function weekStart(d: Date) {
  const day = d.getUTCDay() || 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 1)).toISOString().slice(0, 10);
}

export const minutesLabel = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

export const STATUS_TONE = { ONBOARDING: "accent", ACTIVE: "success", ON_LEAVE: "warning", OFFBOARDING: "warning", TERMINATED: "neutral" } as const;
export const STAGE_TONE = { APPLIED: "neutral", SCREENING: "accent", INTERVIEW: "accent", OFFER: "warning", HIRED: "success", REJECTED: "danger" } as const;
export const LEAVE_TONE = { PENDING: "warning", APPROVED: "success", REJECTED: "danger", CANCELLED: "neutral" } as const;

export const fileSize = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
