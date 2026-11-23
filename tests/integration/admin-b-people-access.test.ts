import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { userContext } from "@/server/core/context";
import { createOrganization } from "@/server/modules/organizations/service";
import { createSession, validateSessionToken } from "@/server/modules/auth/session";
import { beginTotpSetup, confirmTotpSetup } from "@/server/modules/auth/service";
import { currentStep, hotp } from "@/server/modules/auth/totp";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { PLATFORM_ID, orgChain, platformChain } from "@/server/modules/rbac/scope";
import { purgeDueDeletions, requestUserDeletion, restoreUser, setUserRestrictions, sweepExpiredPlatformGrants, grantPlatformRole } from "@/server/modules/admin/users";
import { closeOrganization, reopenOrganization } from "@/server/modules/admin/tenants";
import { createPlatformRole, updatePlatformRole, breakGlass } from "@/server/modules/admin/roles";
import { closeAccessReview, createAccessReview, decideAccessReviewItem, getAccessReview } from "@/server/modules/admin/access-reviews";
import { endImpersonation, impersonationForSession, impersonationRequestGate, redeemImpersonationToken, startImpersonation, sweepImpersonations } from "@/server/modules/admin/impersonation";
import { expectCode, grant, makeUser, resetDb } from "../helpers";

beforeAll(async () => {
  await resetDb();
  await db().$executeRawUnsafe(`TRUNCATE "admin_impersonations", "platform_access_review_items", "platform_access_reviews"`);
  await db().$executeRawUnsafe(`DELETE FROM roles WHERE organization_id IS NULL AND is_system = false`);
});

/** A super admin with a real session and TOTP enrolled; `code()` hands out single-use recovery codes for MFA re-checks. */
async function superAdmin(role = "SUPER_ADMIN") {
  const u = await makeUser({ name: `Root ${role}` });
  await grant(u.user.id, role, "PLATFORM", PLATFORM_ID);
  const { session } = await createSession(db(), u.user.id, { mfaPending: false, mfaVerifiedAt: new Date() });
  const ctx = userContext(u.user.id, { sessionId: session.id, mfaVerifiedAt: new Date() });
  const { secret } = await beginTotpSetup(ctx, u.user.id);
  const { recoveryCodes } = await confirmTotpSetup(ctx, session.id, u.user.id, hotp(secret, currentStep()));
  const codes = [...recoveryCodes];
  return { ...u, ctx, code: () => codes.shift()! };
}

describe("delete with a grace period", () => {
  it("locks the account, restores it, and purges (anonymizes) only after the grace period", async () => {
    const admin = await superAdmin();
    const target = await makeUser({ name: "Leaving Soon" });
    const { token } = await createSession(db(), target.user.id, { mfaPending: false });
    await expect(requestUserDeletion(admin.ctx, target.user.id, { reason: "GDPR request #7", confirm: "wrong", graceDays: 14 })).rejects.toThrow(/confirmation/);
    const r = await requestUserDeletion(admin.ctx, target.user.id, { reason: "GDPR request #7", confirm: target.user.email, graceDays: 14 });
    expect(r.status).toBe("PENDING_DELETION");
    expect(await validateSessionToken(token)).toBeNull();

    await restoreUser(admin.ctx, target.user.id, { reason: "Customer changed their mind" });
    expect((await db().user.findUniqueOrThrow({ where: { id: target.user.id } })).status).toBe("ACTIVE");

    await requestUserDeletion(admin.ctx, target.user.id, { reason: "GDPR request #8", confirm: target.user.email, graceDays: 1 });
    expect(await purgeDueDeletions(new Date())).toBe(0); // still in the grace period
    expect(await purgeDueDeletions(new Date(Date.now() + 2 * 86_400_000))).toBe(1);
    const after = await db().user.findUniqueOrThrow({ where: { id: target.user.id } });
    expect(after.status).toBe("DELETED");
    expect(after.email).toBe(`deleted+${target.user.id}@deleted.invalid`);
    const actions = (await db().auditLog.findMany({ where: { resourceId: target.user.id, action: { startsWith: "user.deletion" } }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["user.deletion_requested", "user.deletion_canceled", "user.deletion_requested"]);
  });
});

describe("restrictions and archived organizations are enforced in rbac", () => {
  it("a read-only account keeps reads but loses writes; a CLOSED organization grants nothing until reopened", async () => {
    const admin = await superAdmin();
    const owner = await makeUser({ name: "Owner" });
    const org = await createOrganization(owner.ctx, { name: "Restricted Co" });
    expect(await can(owner.ctx, "companies.manage", orgChain(org.id))).toBe(true);

    await setUserRestrictions(admin.ctx, owner.user.id, { readOnly: true, aiDisabled: false, reason: "Chargeback investigation" });
    const fresh = userContext(owner.user.id, { mfaVerifiedAt: new Date() });
    expect(await can(fresh, "companies.read", orgChain(org.id))).toBe(true);
    expect(await can(fresh, "companies.manage", orgChain(org.id))).toBe(false);
    await expectCode(requirePermission(fresh, "companies.manage", orgChain(org.id)), "forbidden");
    await setUserRestrictions(admin.ctx, owner.user.id, { readOnly: false, aiDisabled: true, reason: "AI abuse" });
    const ai = userContext(owner.user.id, { mfaVerifiedAt: new Date() });
    expect(await can(ai, "agents.run", orgChain(org.id))).toBe(false);
    expect(await can(ai, "companies.manage", orgChain(org.id))).toBe(true);
    await expectCode(setUserRestrictions(admin.ctx, admin.user.id, { readOnly: true, aiDisabled: false, reason: "self" }), "validation_error");

    const org2 = await db().organization.findUniqueOrThrow({ where: { id: org.id } });
    await expect(closeOrganization(admin.ctx, org.id, { reason: "Fraud", confirm: "nope" })).rejects.toThrow(/confirmation/);
    await closeOrganization(admin.ctx, org.id, { reason: "Fraud ring", confirm: org2.slug });
    const closedCtx = userContext(owner.user.id, { mfaVerifiedAt: new Date() });
    expect(await can(closedCtx, "companies.read", orgChain(org.id))).toBe(false);
    expect((await db().organization.findUniqueOrThrow({ where: { id: org.id } })).closedAt).not.toBeNull();
    await reopenOrganization(admin.ctx, org.id, { reason: "Cleared" });
    expect(await can(userContext(owner.user.id, { mfaVerifiedAt: new Date() }), "companies.read", orgChain(org.id))).toBe(true);
  });
});

describe("audited impersonation", () => {
  it("super admin only, one-time link, read-only by default, attributed, ended any time", async () => {
    const admin = await superAdmin();
    const target = await makeUser({ name: "Customer" });
    const org = await createOrganization(target.ctx, { name: "Impersonated Co" });

    const platformAdmin = await superAdmin("PLATFORM_ADMIN");
    await expectCode(startImpersonation(platformAdmin.ctx, { userId: target.user.id, reason: "Debug the dashboard", mfaCode: platformAdmin.code() }), "forbidden");
    await expectCode(startImpersonation(admin.ctx, { userId: platformAdmin.user.id, reason: "Should never work", mfaCode: admin.code() }), "conflict");
    await expectCode(startImpersonation(admin.ctx, { userId: target.user.id, reason: "Write without confirm", mode: "FULL", mfaCode: admin.code() }), "validation_error");
    await expect(startImpersonation(admin.ctx, { userId: target.user.id, reason: "short" })).rejects.toThrow();

    const started = await startImpersonation(admin.ctx, { userId: target.user.id, reason: "Ticket 4411: broken invoice view", ticketRef: "SUP-4411", minutes: 15, mfaCode: admin.code() });
    expect(started.mode).toBe("READ_ONLY");
    const token = decodeURIComponent(started.url.split("/impersonate/")[1]!);
    const redeemed = await redeemImpersonationToken(token, { ip: "192.0.2.1", userAgent: "vitest" });
    await expectCode(redeemImpersonationToken(token, { ip: null, userAgent: null }), "not_found"); // one-time

    const session = await validateSessionToken(redeemed.sessionToken);
    expect(session?.userId).toBe(target.user.id);
    expect(session!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60_000 + 1000);
    const row = await db().session.findUniqueOrThrow({ where: { id: session!.id } });
    expect(row.impersonatorId).toBe(admin.user.id);

    const ictx = userContext(target.user.id, { sessionId: session!.id, mfaVerifiedAt: null });
    expect(await can(ictx, "companies.read", orgChain(org.id))).toBe(true);
    expect(await can(ictx, "companies.manage", orgChain(org.id))).toBe(false);
    await expect(requirePermission(ictx, "companies.manage", orgChain(org.id))).rejects.toMatchObject({ details: { reason: "impersonation_read_only" } });
    await expect(impersonationRequestGate({ sessionId: session!.id, method: "POST", pathname: "/api/v1/organizations/x/companies" })).rejects.toMatchObject({ code: "forbidden" });
    await impersonationRequestGate({ sessionId: session!.id, method: "GET", pathname: "/api/v1/organizations/x/companies" });
    await impersonationRequestGate({ sessionId: session!.id, method: "POST", pathname: "/api/v1/auth/sign-out" });
    expect((await impersonationForSession(session!.id))?.admin?.id).toBe(admin.user.id);

    await endImpersonation(admin.ctx, redeemed.impersonationId, {});
    expect(await validateSessionToken(redeemed.sessionToken)).toBeNull();
    const audit = (await db().auditLog.findMany({ where: { resourceId: target.user.id, action: { startsWith: "platform.impersonation" } }, orderBy: { createdAt: "asc" } })).map((a) => [a.action, a.actorId]);
    expect(audit).toEqual([
      ["platform.impersonation.started", admin.user.id],
      ["platform.impersonation.redeemed", admin.user.id],
      ["platform.impersonation.ended", admin.user.id],
    ]);
  });

  it("write mode needs the typed confirmation, never reaches platform permissions, and expires", async () => {
    const admin = await superAdmin();
    const target = await makeUser({ name: "Writer" });
    const org = await createOrganization(target.ctx, { name: "Write Co" });
    const started = await startImpersonation(admin.ctx, { userId: target.user.id, reason: "Reproduce the save bug", mode: "FULL", confirmWrite: target.user.email, minutes: 5, mfaCode: admin.code() });
    const r = await redeemImpersonationToken(decodeURIComponent(started.url.split("/impersonate/")[1]!), { ip: null, userAgent: null });
    const s = (await validateSessionToken(r.sessionToken))!;
    const ictx = userContext(target.user.id, { sessionId: s.id, mfaVerifiedAt: null });
    expect(await can(ictx, "companies.manage", orgChain(org.id))).toBe(true);
    expect(await can(ictx, "billing.manage", orgChain(org.id))).toBe(true); // granted, but MFA-gated:
    await expectCode(requirePermission(ictx, "billing.manage", orgChain(org.id)), "mfa_required");
    await impersonationRequestGate({ sessionId: s.id, method: "POST", pathname: "/api/v1/organizations/x/companies" });
    expect(await sweepImpersonations(new Date(Date.now() + 6 * 60_000))).toBe(1);
    expect(await validateSessionToken(r.sessionToken)).toBeNull();
  });
});

describe("custom platform roles, temporary grants, break-glass and access reviews", () => {
  it("custom roles hold only platform permissions the editor holds; built-ins are immutable", async () => {
    const admin = await superAdmin();
    await expectCode(createPlatformRole(admin.ctx, { key: "support-lite", name: "Support lite", permissions: ["companies.read"], reason: "New tier", mfaCode: admin.code() }), "validation_error");
    const role = await createPlatformRole(admin.ctx, { key: "support-lite", name: "Support lite", permissions: ["platform.users.read", "platform.support.read"], reason: "New tier", mfaCode: admin.code() });
    const sec = await superAdmin("SECURITY_ADMIN");
    await expectCode(createPlatformRole(sec.ctx, { key: "x-role", name: "X", permissions: ["platform.users.read"], reason: "No roles.manage", mfaCode: sec.code() }), "forbidden");
    const superRole = await db().role.findFirstOrThrow({ where: { organizationId: null, key: "SUPER_ADMIN" } });
    await expectCode(updatePlatformRole(admin.ctx, superRole.id, { name: "Hacked", reason: "try it", mfaCode: admin.code() }), "forbidden");
    const upd = await updatePlatformRole(admin.ctx, role.id, { permissions: ["platform.users.read"], reason: "Narrow it", mfaCode: admin.code() });
    expect(upd.removed).toEqual(["platform.support.read"]);

    const holder = await makeUser({ name: "Temp holder" });
    const g = await grantPlatformRole(admin.ctx, holder.user.id, { roleKey: "support-lite", reason: "Cover for a week", expiresAt: new Date(Date.now() + 3_600_000) });
    expect(await can(userContext(holder.user.id, { mfaVerifiedAt: new Date() }), "platform.users.read", platformChain())).toBe(true);
    await db().roleAssignment.update({ where: { id: g.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await can(userContext(holder.user.id, { mfaVerifiedAt: new Date() }), "platform.users.read", platformChain())).toBe(false);
    expect(await sweepExpiredPlatformGrants()).toBeGreaterThanOrEqual(1);
    expect(await db().roleAssignment.findUnique({ where: { id: g.id } })).toBeNull();
  });

  it("break-glass gives a security admin time-boxed SUPER_ADMIN with the typed phrase", async () => {
    const sec = await superAdmin("SECURITY_ADMIN");
    await expectCode(breakGlass(sec.ctx, { minutes: 30, reason: "Primary super admin locked out of MFA", confirm: "please", mfaCode: sec.code() }), "validation_error");
    const r = await breakGlass(sec.ctx, { minutes: 30, reason: "Primary super admin locked out of MFA", confirm: "BREAK GLASS", mfaCode: sec.code() });
    expect(r.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(await can(userContext(sec.user.id, { mfaVerifiedAt: new Date() }), "platform.impersonate", platformChain())).toBe(true);
    await expectCode(breakGlass(sec.ctx, { minutes: 30, reason: "Primary super admin locked out of MFA", confirm: "BREAK GLASS", mfaCode: sec.code() }), "conflict");
  });

  it("access reviews snapshot platform grants; REVOKE removes the grant; completion needs every decision", async () => {
    const admin = await superAdmin();
    const other = await superAdmin("READ_ONLY_ADMIN");
    const review = await createAccessReview(admin.ctx, { title: "Q4 platform access", reason: "Quarterly SOC 2 review" });
    const full = await getAccessReview(admin.ctx, review.id);
    const mine = full.items.find((i) => i.principalId === admin.user.id)!;
    await expectCode(decideAccessReviewItem(admin.ctx, review.id, mine.id, { decision: "KEEP", reason: "self" }), "validation_error");
    const target = full.items.find((i) => i.principalId === other.user.id)!;
    const d = await decideAccessReviewItem(admin.ctx, review.id, target.id, { decision: "REVOKE", reason: "No longer needed" });
    expect(d.revoked).toBe(true);
    expect(await db().roleAssignment.findUnique({ where: { id: target.assignmentId } })).toBeNull();
    await expectCode(closeAccessReview(admin.ctx, review.id, { action: "complete", reason: "done" }), "conflict");
    expect((await closeAccessReview(admin.ctx, review.id, { action: "cancel", reason: "Superseded" })).status).toBe("CANCELED");
  });
});
