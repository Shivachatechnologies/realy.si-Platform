import { z } from "zod";
import { db } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { closestLocale } from "@/i18n/config";
import { SITE_DEPARTMENT_KEYS } from "./content";

/** Team-size buckets offered on the waitlist form. */
export const TEAM_SIZES = ["solo", "2-10", "11-50", "51-200", "200+"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const waitlistInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: optionalText(120),
  company: optionalText(160),
  role: optionalText(120),
  teamSize: z.enum(TEAM_SIZES).optional(),
  interests: z.array(z.enum(SITE_DEPARTMENT_KEYS)).max(SITE_DEPARTMENT_KEYS.length).default([]),
  note: optionalText(1000),
  locale: z.string().max(20).optional(),
  source: optionalText(200),
  /** Must be true: the visitor agreed to be contacted about access. */
  consent: z.literal(true),
  /** Honeypot: humans never see or fill this field. */
  website: z.string().max(200).optional(),
});

const log = logger.child({ component: "site-waitlist" });

/**
 * Add (or refresh) a waitlist entry. Idempotent per email: a repeat submission updates the details instead of creating a
 * duplicate, and the response is the same either way so the form never reveals whether an email is already listed.
 * Bots that fill the honeypot get the same response and nothing is stored.
 */
export async function joinWaitlist(raw: z.input<typeof waitlistInput>): Promise<{ ok: true }> {
  const input = waitlistInput.parse(raw);
  if (input.website) return { ok: true };
  const details = {
    name: input.name ?? null,
    company: input.company ?? null,
    role: input.role ?? null,
    teamSize: input.teamSize ?? null,
    interests: input.interests,
    note: input.note ?? null,
    locale: closestLocale(input.locale),
    source: input.source ?? null,
  };
  const row = await db().siteWaitlistEntry.upsert({
    where: { email: input.email },
    create: { email: input.email, ...details, consentAt: new Date() },
    update: { ...details, consentAt: new Date() },
    select: { id: true, createdAt: true, updatedAt: true },
  });
  log.info({ entryId: row.id, repeat: row.updatedAt.getTime() - row.createdAt.getTime() > 1000 }, "waitlist entry saved");
  return { ok: true };
}
