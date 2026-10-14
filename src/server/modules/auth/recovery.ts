import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import { env } from "@/server/core/env";
import { randomToken, sha256 } from "@/server/core/crypto";
import { AppError, invalid } from "@/server/core/errors";
import type { RequestContext } from "@/server/core/context";
import { securityEvent } from "@/server/core/telemetry";
import { writeAudit } from "@/server/modules/audit/service";
import { emailConfigured, sendEmail, type SendResult } from "@/server/modules/email/service";
import { closestLocale } from "@/i18n/config";
import { dummyHash, hashPassword, PASSWORD_MAX, PASSWORD_MIN, verifyPassword } from "./password";
import { revokeAllSessions } from "./session";

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

/** Links carry the token in the URL fragment so it never reaches server logs, proxies or Referer headers. */
export function tokenLink(locale: string, path: string, token: string): string {
  return `${env().APP_URL}/${closestLocale(locale)}${path}#token=${encodeURIComponent(token)}`;
}

// ───────────── Email verification ─────────────

/** Issue a verification token for the user's current email and send it (truthfully reports NOT_CONFIGURED). */
export async function sendEmailVerification(userId: string): Promise<SendResult> {
  const user = await db().user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerifiedAt) return { status: "SENT", messageId: null };
  const token = randomToken(32);
  await transaction(async (tx) => {
    // Only the newest link works.
    await tx.emailVerificationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
    await tx.emailVerificationToken.create({
      data: { userId, email: user.email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS) },
    });
  });
  return sendEmail({ to: user.email, template: "verify_email", locale: user.locale, vars: {}, link: tokenLink(user.locale, "/verify-email", token), userId });
}

export async function verifyEmail(ctx: RequestContext, token: string): Promise<void> {
  await transaction(async (tx) => {
    const row = await tx.emailVerificationToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    const now = new Date();
    if (!row || row.usedAt || row.expiresAt <= now || row.email !== row.user.email) {
      throw new AppError("validation_error", "Verification link is invalid or expired");
    }
    const used = await tx.emailVerificationToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
    if (used.count !== 1) throw new AppError("validation_error", "Verification link is invalid or expired");
    await tx.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: now } });
    await writeAudit(tx, { ...ctx, actor: { type: "USER", id: row.userId } }, { category: "SECURITY", action: "auth.email_verified", resourceType: "user", resourceId: row.userId });
  });
}

// ───────────── Password reset ─────────────

export const forgotPasswordInput = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
export const resetPasswordInput = z.object({ token: z.string().min(20).max(128), password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX) });

/**
 * Start a password reset. The response never reveals whether the account exists; it only reports
 * whether email delivery is configured at all (a global fact), so the UI never claims an email was sent
 * when none could be.
 */
export async function requestPasswordReset(ctx: RequestContext, raw: z.input<typeof forgotPasswordInput>): Promise<{ emailDelivery: "configured" | "not_configured" }> {
  const { email } = forgotPasswordInput.parse(raw);
  const configured = emailConfigured();
  const user = await db().user.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE") {
    await dummyHash(); // keep timing similar to the existing-account path
    return { emailDelivery: configured ? "configured" : "not_configured" };
  }
  const token = randomToken(32);
  await transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS) } });
    await writeAudit(tx, { ...ctx, actor: { type: "USER", id: user.id } }, { category: "SECURITY", action: "auth.password_reset_requested", resourceType: "user", resourceId: user.id });
  });
  await sendEmail({ to: user.email, template: "password_reset", locale: user.locale, vars: {}, link: tokenLink(user.locale, "/reset-password", token), userId: user.id });
  return { emailDelivery: configured ? "configured" : "not_configured" };
}

/** Complete a reset: single-use token, new password, every existing session revoked. */
export async function resetPassword(ctx: RequestContext, raw: z.input<typeof resetPasswordInput>): Promise<void> {
  const input = resetPasswordInput.parse(raw);
  const passwordHash = await hashPassword(input.password);
  await transaction(async (tx) => {
    const row = await tx.passwordResetToken.findUnique({ where: { tokenHash: sha256(input.token) }, include: { user: true } });
    const now = new Date();
    if (!row || row.usedAt || row.expiresAt <= now || row.user.status !== "ACTIVE") {
      securityEvent("auth.password_reset_invalid_token", {});
      throw new AppError("validation_error", "Reset link is invalid or expired");
    }
    const used = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
    if (used.count !== 1) throw new AppError("validation_error", "Reset link is invalid or expired");
    if (row.user.passwordHash && (await verifyPassword(row.user.passwordHash, input.password))) {
      throw invalid("Choose a password you haven't used for this account", { field: "password" });
    }
    // Possession of the emailed link proves control of the address.
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash, emailVerifiedAt: row.user.emailVerifiedAt ?? now } });
    await revokeAllSessions(tx, row.userId);
    await writeAudit(tx, { ...ctx, actor: { type: "USER", id: row.userId } }, { category: "SECURITY", action: "auth.password_reset", resourceType: "user", resourceId: row.userId });
  });
}

/** Maintenance: remove expired/used tokens older than a day (run by the worker). */
export async function purgeExpiredAuthTokens(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const a = await db().passwordResetToken.deleteMany({ where: { OR: [{ expiresAt: { lte: cutoff } }, { usedAt: { lte: cutoff } }] } });
  const b = await db().emailVerificationToken.deleteMany({ where: { OR: [{ expiresAt: { lte: cutoff } }, { usedAt: { lte: cutoff } }] } });
  return a.count + b.count;
}
