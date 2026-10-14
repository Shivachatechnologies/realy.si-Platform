import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "@/server/core/crypto";
import { AppError, conflict, invalid } from "@/server/core/errors";
import type { RequestContext } from "@/server/core/context";
import { writeAudit } from "@/server/modules/audit/service";
import { emitEvent } from "@/server/modules/events/emit";
import { closestLocale } from "@/i18n/config";
import { dummyHash, hashPassword, PASSWORD_MAX, PASSWORD_MIN, verifyPassword } from "./password";
import { createSession, revokeAllSessions, type SessionInfo } from "./session";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "./totp";

const TOTP_PURPOSE = "mfa.totp";
const RECOVERY_CODE_COUNT = 10;

const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Unknown IANA timezone");

export const signUpInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
  name: z.string().trim().min(1).max(120),
  locale: z.string().max(35).optional(),
  timezone: timezone.optional(),
  countryCode: z.string().regex(/^[A-Z]{2}$/).optional(),
});

export const signInInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(PASSWORD_MAX),
});

export interface AuthResult {
  token: string;
  session: SessionInfo;
  mfaRequired: boolean;
}

export async function signUp(ctx: RequestContext, raw: z.input<typeof signUpInput>): Promise<AuthResult> {
  const input = signUpInput.parse(raw);
  if (input.countryCode) {
    const c = await db().country.findUnique({ where: { code: input.countryCode }, select: { code: true } });
    if (!c) throw invalid("Unknown country");
  }
  const passwordHash = await hashPassword(input.password);
  return transaction(async (tx) => {
    const exists = await tx.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (exists) throw conflict("An account with this email already exists");
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        locale: closestLocale(input.locale),
        timezone: input.timezone ?? "UTC",
        countryCode: input.countryCode ?? null,
      },
    });
    const actorCtx: RequestContext = { ...ctx, actor: { type: "USER", id: user.id } };
    await writeAudit(tx, actorCtx, {
      category: "SECURITY",
      action: "user.registered",
      resourceType: "user",
      resourceId: user.id,
      newValue: { email: user.email, locale: user.locale, countryCode: user.countryCode },
    });
    await emitEvent(tx, actorCtx, "user.registered", { userId: user.id, locale: user.locale }, {
      aggregateType: "user",
      aggregateId: user.id,
    });
    const { token, session } = await createSession(tx, user.id, { mfaPending: false, ip: ctx.ip, userAgent: ctx.userAgent });
    return { token, session, mfaRequired: false };
  });
}

export async function signIn(ctx: RequestContext, raw: z.input<typeof signInInput>): Promise<AuthResult> {
  const input = signInInput.parse(raw);
  const user = await db().user.findUnique({ where: { email: input.email } });
  const ok = user?.passwordHash
    ? await verifyPassword(user.passwordHash, input.password)
    : (await verifyPassword(await dummyHash(), input.password), false);
  if (!user || !ok || user.status !== "ACTIVE") {
    await transaction((tx) =>
      writeAudit(tx, ctx, {
        category: "SECURITY",
        action: "auth.sign_in_failed",
        resourceType: "user",
        resourceId: user?.id ?? null,
        newValue: { email: input.email },
      }),
    );
    throw new AppError("unauthenticated", "Invalid email or password");
  }
  return transaction(async (tx) => {
    const actorCtx: RequestContext = { ...ctx, actor: { type: "USER", id: user.id } };
    const { token, session } = await createSession(tx, user.id, {
      mfaPending: user.mfaEnabled,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    await writeAudit(tx, actorCtx, {
      category: "SECURITY",
      action: user.mfaEnabled ? "auth.sign_in_mfa_pending" : "auth.sign_in",
      resourceType: "session",
      resourceId: session.id,
    });
    return { token, session, mfaRequired: user.mfaEnabled };
  });
}

/** Complete MFA for a pending session (TOTP or a one-time recovery code); also refreshes MFA freshness. */
export async function verifyMfa(ctx: RequestContext, sessionId: string, userId: string, code: string): Promise<void> {
  const trimmed = code.replace(/\s/g, "");
  await transaction(async (tx) => {
    const factor = await tx.mfaFactor.findFirst({ where: { userId, type: "TOTP", confirmedAt: { not: null } } });
    if (!factor) throw invalid("MFA is not enabled");
    let method: "totp" | "recovery" | null = null;
    const step = verifyTotp(decryptSecret(factor.secretEncrypted, TOTP_PURPOSE), trimmed);
    if (step !== null && (factor.lastUsedStep === null || step > factor.lastUsedStep)) {
      await tx.mfaFactor.update({ where: { id: factor.id }, data: { lastUsedStep: step } });
      method = "totp";
    } else if (/^[a-z0-9-]{10,20}$/i.test(trimmed)) {
      const used = await tx.mfaRecoveryCode.updateMany({
        where: { userId, codeHash: sha256(trimmed.toLowerCase()), usedAt: null },
        data: { usedAt: new Date() },
      });
      if (used.count === 1) method = "recovery";
    }
    if (!method) {
      await writeAudit(tx, ctx, { category: "SECURITY", action: "auth.mfa_failed", resourceType: "session", resourceId: sessionId });
      throw new AppError("unauthenticated", "Invalid verification code");
    }
    await tx.session.update({ where: { id: sessionId }, data: { mfaPending: false, mfaVerifiedAt: new Date() } });
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      action: "auth.mfa_verified",
      resourceType: "session",
      resourceId: sessionId,
      newValue: { method },
    });
  });
}

/** Start TOTP enrollment: stores an unconfirmed, encrypted secret and returns the provisioning URL. */
export async function beginTotpSetup(ctx: RequestContext, userId: string): Promise<{ secret: string; otpauthUrl: string }> {
  const user = await db().user.findUniqueOrThrow({ where: { id: userId } });
  if (user.mfaEnabled) throw conflict("MFA is already enabled");
  const secret = generateTotpSecret();
  await transaction(async (tx) => {
    await tx.mfaFactor.deleteMany({ where: { userId, confirmedAt: null } });
    await tx.mfaFactor.create({ data: { userId, type: "TOTP", secretEncrypted: encryptSecret(secret, TOTP_PURPOSE) } });
  });
  return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
}

/** Confirm enrollment with a code; enables MFA, returns one-time recovery codes, revokes other sessions. */
export async function confirmTotpSetup(
  ctx: RequestContext,
  sessionId: string,
  userId: string,
  code: string,
): Promise<{ recoveryCodes: string[] }> {
  return transaction(async (tx) => {
    const factor = await tx.mfaFactor.findFirst({ where: { userId, type: "TOTP", confirmedAt: null }, orderBy: { createdAt: "desc" } });
    if (!factor) throw invalid("No pending MFA enrollment");
    const step = verifyTotp(decryptSecret(factor.secretEncrypted, TOTP_PURPOSE), code.trim());
    if (step === null) throw invalid("Invalid verification code");
    const now = new Date();
    await tx.mfaFactor.update({ where: { id: factor.id }, data: { confirmedAt: now, lastUsedStep: step } });
    await tx.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const raw = randomToken(8).toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(10, "x").slice(0, 10);
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    await tx.mfaRecoveryCode.createMany({ data: recoveryCodes.map((c) => ({ userId, codeHash: sha256(c) })) });
    await tx.session.update({ where: { id: sessionId }, data: { mfaPending: false, mfaVerifiedAt: now } });
    await revokeAllSessions(tx, userId, sessionId);
    await writeAudit(tx, ctx, { category: "SECURITY", action: "auth.mfa_enabled", resourceType: "user", resourceId: userId });
    return { recoveryCodes };
  });
}
