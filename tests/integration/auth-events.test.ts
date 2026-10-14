import { beforeAll, describe, expect, it } from "vitest";
import { db, transaction } from "@/server/core/db";
import { userContext, systemContext } from "@/server/core/context";
import { beginTotpSetup, confirmTotpSetup, signIn, signUp, verifyMfa } from "@/server/modules/auth/service";
import { validateSessionToken } from "@/server/modules/auth/session";
import { hotp, currentStep } from "@/server/modules/auth/totp";
import { writeAudit } from "@/server/modules/audit/service";
import { emitEvent } from "@/server/modules/events/emit";
import { relayBatch, type OutboxEvent } from "@/server/modules/events/relay";
import { createOrganization } from "@/server/modules/organizations/service";
import { expectCode, resetDb } from "../helpers";

beforeAll(resetDb);

const anon = () => systemContext();

describe("authentication", () => {
  it("sign-up creates a user, session, audit and event; passwords are argon2id hashed", async () => {
    const r = await signUp(anon(), { email: " Ada@Example.test ", password: "a-very-long-password", name: "Ada", locale: "ar", countryCode: "AE", timezone: "Asia/Dubai" });
    const user = await db().user.findUniqueOrThrow({ where: { email: "ada@example.test" } });
    expect(user.locale).toBe("ar-AE");
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect((await validateSessionToken(r.token))?.userId).toBe(user.id);
    const stored = await db().session.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.tokenHash).not.toContain(r.token);
    expect(await db().event.count({ where: { type: "user.registered", aggregateId: user.id } })).toBe(1);
    await expectCode(signUp(anon(), { email: "ada@example.test", password: "another-long-password", name: "Dup" }), "conflict");
  });

  it("rejects short passwords, unknown countries and invalid timezones", async () => {
    await expect(signUp(anon(), { email: "b@example.test", password: "short", name: "B" })).rejects.toThrow();
    await expectCode(signUp(anon(), { email: "c@example.test", password: "a-very-long-password", name: "C", countryCode: "ZZ" }), "validation_error");
    await expect(signUp(anon(), { email: "d@example.test", password: "a-very-long-password", name: "D", timezone: "Mars/Olympus" })).rejects.toThrow();
  });

  it("wrong password and unknown email fail identically and are audited", async () => {
    await signUp(anon(), { email: "eve@example.test", password: "a-very-long-password", name: "Eve" });
    const e1 = await expectCode(signIn(anon(), { email: "eve@example.test", password: "wrong-password-123" }), "unauthenticated");
    const e2 = await expectCode(signIn(anon(), { email: "nobody@example.test", password: "wrong-password-123" }), "unauthenticated");
    expect((e1 as Error).message).toBe((e2 as Error).message);
    expect(await db().auditLog.count({ where: { action: "auth.sign_in_failed" } })).toBeGreaterThanOrEqual(2);
  });

  it("TOTP enrollment, MFA-pending sign-in, replay protection and single-use recovery codes", async () => {
    const reg = await signUp(anon(), { email: "mfa@example.test", password: "a-very-long-password", name: "Mfa" });
    const ctx = userContext(reg.session.userId, { sessionId: reg.session.id });
    const { secret, otpauthUrl } = await beginTotpSetup(ctx, reg.session.userId);
    expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\/Realy:mfa%40example.test\?secret=/);
    const factor = await db().mfaFactor.findFirstOrThrow({ where: { userId: reg.session.userId } });
    expect(factor.secretEncrypted).not.toContain(secret);

    const step = currentStep();
    const { recoveryCodes } = await confirmTotpSetup(ctx, reg.session.id, reg.session.userId, hotp(secret, step));
    expect(recoveryCodes).toHaveLength(10);

    const login = await signIn(anon(), { email: "mfa@example.test", password: "a-very-long-password" });
    expect(login.mfaRequired).toBe(true);
    expect((await validateSessionToken(login.token))?.mfaPending).toBe(true);

    // The code used at enrollment cannot be replayed.
    await expectCode(verifyMfa(ctx, login.session.id, login.session.userId, hotp(secret, step)), "unauthenticated");
    await verifyMfa(ctx, login.session.id, login.session.userId, hotp(secret, step + 1n));
    const s = await validateSessionToken(login.token);
    expect(s?.mfaPending).toBe(false);
    expect(s?.mfaVerifiedAt).not.toBeNull();

    const login2 = await signIn(anon(), { email: "mfa@example.test", password: "a-very-long-password" });
    await verifyMfa(ctx, login2.session.id, login2.session.userId, recoveryCodes[0]!);
    const login3 = await signIn(anon(), { email: "mfa@example.test", password: "a-very-long-password" });
    await expectCode(verifyMfa(ctx, login3.session.id, login3.session.userId, recoveryCodes[0]!), "unauthenticated");
  });
});

describe("audit + outbox atomicity", () => {
  it("a rolled-back transaction leaves neither audit rows nor events", async () => {
    const ctx = systemContext();
    const before = [await db().auditLog.count(), await db().event.count()];
    await expect(
      transaction(async (tx) => {
        await writeAudit(tx, ctx, { category: "ADMIN", action: "test.rollback", resourceType: "test" });
        await emitEvent(tx, ctx, "feature_flag.updated", { flagId: crypto.randomUUID(), key: "x" }, { aggregateType: "test", aggregateId: "x" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect([await db().auditLog.count(), await db().event.count()]).toEqual(before);
  });

  it("rejects unregistered event payloads", async () => {
    await expect(
      transaction((tx) =>
        emitEvent(tx, systemContext(), "company.created", { companyId: "not-a-uuid" } as never, { aggregateType: "company", aggregateId: "x" }),
      ),
    ).rejects.toThrow();
  });

  it("audit logs are append-only at the database level", async () => {
    const row = await db().auditLog.findFirstOrThrow();
    await expect(db().auditLog.update({ where: { id: row.id }, data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(db().auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });

  it("the relay publishes each event once and records failures for retry", async () => {
    const reg = await signUp(anon(), { email: "relay@example.test", password: "a-very-long-password", name: "Relay" });
    await createOrganization(userContext(reg.session.userId), { name: "Relay Co" });

    await expect(relayBatch(async () => Promise.reject(new Error("redis down")))).rejects.toThrow("redis down");
    const failed = await db().event.findFirstOrThrow({ where: { type: "organization.created", publishedAt: null } });
    expect(failed.attempts).toBe(1);
    expect(failed.lastError).toContain("redis down");
    const published: OutboxEvent[] = [];
    let total = 0;
    for (let n = await relayBatch(async (e) => void published.push(...e), 3); n > 0; n = await relayBatch(async (e) => void published.push(...e), 3)) total += n;
    expect(total).toBe(published.length);
    expect(new Set(published.map((e) => e.id)).size).toBe(published.length);
    expect(published.some((e) => e.type === "organization.created")).toBe(true);
    expect(await db().event.count({ where: { publishedAt: null } })).toBe(0);
    expect(await relayBatch(async () => undefined)).toBe(0);
  });
});
