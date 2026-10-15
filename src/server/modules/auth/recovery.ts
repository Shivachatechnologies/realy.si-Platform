import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import { env } from "@/server/core/env";
import { randomToken, sha256 } from "@/server/core/crypto";
import { AppError, invalid } from "@/server/core/errors";
import { systemContext, type RequestContext } from "@/server/core/context";
import { enqueuePasswordReset, type PasswordResetJob } from "@/server/core/jobs";
import { securityEvent } from "@/server/core/telemetry";
import { writeAudit } from "@/server/modules/audit/service";
import { emailConfigured, sendEmail, type SendResult } from "@/server/modules/email/service";
import { closestLocale } from "@/i18n/config";
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN, verifyPassword } from "./password";
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
    // Bound to the signed-in account; another account's link is reported exactly like an invalid one.
    if (!row || row.usedAt || row.expiresAt <= now || row.email !== row.user.email || row.userId !== ctx.actor.id) {
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
 * Request a reset link. Account enumeration: the response — status, body and timing — must not depend on
 * whether an account exists. So the request path does only account-independent work (validation, rate
 * limits, one queue write) and the worker does the lookup, token and email (processPasswordResetRequest).
 * `emailDelivery` reports whether email is configured at all (a global fact), so the UI never claims an
 * email was sent when none could be.
 */
export async function requestPasswordReset(ctx: RequestContext, raw: z.input<typeof forgotPasswordInput>): Promise<{ emailDelivery: "configured" | "not_configured" }> {
  const { email } = forgotPasswordInput.parse(raw);
  await enqueuePasswordReset({ email, requestId: ctx.requestId, ip: ctx.ip, userAgent: ctx.userAgent });
  return { emailDelivery: emailConfigured() ? "configured" : "not_configured" };
}

/** Worker side of requestPasswordReset. Unknown or inactive accounts are a silent no-op. */
export async function processPasswordResetRequest(job: PasswordResetJob): Promise<"sent" | "no_account"> {
  const { email } = forgotPasswordInput.parse({ email: job.email });
  const user = await db().user.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE") return "no_account";
  const ctx: RequestContext = { ...systemContext(job.requestId), actor: { type: "USER", id: user.id }, ip: job.ip, userAgent: job.userAgent };
  const token = randomToken(32);
  await transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS) } });
    await writeAudit(tx, ctx, { category: "SECURITY", action: "auth.password_reset_requested", resourceType: "user", resourceId: user.id });
  });
  const sent = await sendEmail({ to: user.email, template: "password_reset", locale: user.locale, vars: {}, link: tokenLink(user.locale, "/reset-password", token), userId: user.id });
  // A provider failure is retried by the queue (each attempt issues a fresh token and voids the previous one).
  // NOT_CONFIGURED is final: retrying cannot help and the UI already said email is unavailable.
  if (sent.status === "FAILED") throw new Error("password reset email delivery failed");
  return "sent";
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
    if (!row.user.emailVerifiedAt) {
      // The address was never proven before now, so any second factor or OAuth link on the account may
      // belong to someone who registered it first (pre-account hijacking). Only the address owner remains.
      await tx.oAuthAccount.deleteMany({ where: { userId: row.userId } });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: row.userId } });
      await tx.mfaFactor.deleteMany({ where: { userId: row.userId } });
      await tx.user.update({ where: { id: row.userId }, data: { mfaEnabled: false } });
      await writeAudit(tx, { ...ctx, actor: { type: "USER", id: row.userId } }, { category: "SECURITY", action: "auth.unverified_credentials_cleared", resourceType: "user", resourceId: row.userId });
    }
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
