import { db } from "@/server/core/db";

/**
 * Platform email suppression list (`email_suppressions`): addresses the platform provider must not be asked to send to
 * (hard bounces and complaints from provider webhooks, plus manual entries from Admin → Email). Checked by
 * `email/service.ts` before every platform send; a suppressed send is recorded as FAILED with error `suppressed:<reason>`
 * and never reaches the provider.
 */

export type SuppressionReason = "hard_bounce" | "complaint" | "manual";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** The suppression reason for an address, or null. One indexed primary-key read. */
export async function suppressionFor(email: string): Promise<SuppressionReason | null> {
  try {
    const row = await db().emailSuppression.findUnique({ where: { email: normalizeEmail(email) }, select: { reason: true } });
    return (row?.reason as SuppressionReason | undefined) ?? null;
  } catch {
    // The check never blocks a send when the table is unreachable (the send itself records the outcome).
    return null;
  }
}

/** Add (idempotent) an address; returns true when it was newly suppressed. */
export async function suppressAddress(email: string, reason: SuppressionReason, source: string | null, opts: { createdById?: string | null; note?: string | null } = {}): Promise<boolean> {
  const r = await db().emailSuppression.createMany({ data: [{ email: normalizeEmail(email), reason, source, createdById: opts.createdById ?? null, note: opts.note ?? null }], skipDuplicates: true });
  return r.count > 0;
}
