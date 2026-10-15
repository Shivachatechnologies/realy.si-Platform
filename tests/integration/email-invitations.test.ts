import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { setEmailProviderForTests, type EmailProvider, type OutboundEmail } from "@/server/modules/email/provider";
import { renderEmail } from "@/server/modules/email/service";
import { createOrganization } from "@/server/modules/organizations/service";
import { systemRoleId } from "@/server/modules/rbac/service";
import { processPasswordResetRequest, requestPasswordReset, resetPassword, sendEmailVerification, verifyEmail } from "@/server/modules/auth/recovery";
import { signIn } from "@/server/modules/auth/service";
import { validateSessionToken } from "@/server/modules/auth/session";
import { systemContext } from "@/server/core/context";
import { POST as inviteRoute } from "@/app/api/v1/organizations/[orgId]/invitations/route";
import { POST as resendRoute } from "@/app/api/v1/organizations/[orgId]/invitations/[invitationId]/resend/route";
import { DELETE as revokeRoute } from "@/app/api/v1/organizations/[orgId]/invitations/[invitationId]/route";
import { POST as acceptRoute } from "@/app/api/v1/invitations/accept/route";
import { POST as signInRoute } from "@/app/api/v1/auth/sign-in/route";
import { POST as forgotRoute } from "@/app/api/v1/auth/password/forgot/route";
import { POST as verifyRoute } from "@/app/api/v1/auth/email/verify/route";
import { clearJobQueues, expectCode, makeUser, resetDb, runQueuedPasswordResets } from "../helpers";
import { resetJobQueuesForTests, authEmailQueue } from "@/server/core/jobs";
import { params, req, sessionCookie } from "../http";
import { redis } from "@/server/core/rate-limit";

const outbox: (OutboundEmail & { from: string })[] = [];
const capturing: EmailProvider = { id: "test-double", send: async (m) => (outbox.push(m), { messageId: `msg_${outbox.length}` }) };
const failing: EmailProvider = { id: "test-failing", send: async () => Promise.reject(new Error("provider down")) };
const tokenFrom = (m: OutboundEmail) => decodeURIComponent(/#token=([^\s"<]+)/.exec(m.text)![1]!);

beforeAll(async () => {
  await resetDb();
  await clearJobQueues();
  const keys = await redis().keys("rl:*");
  if (keys.length) await redis().del(...keys);
});
afterEach(() => {
  setEmailProviderForTests(undefined);
  outbox.length = 0;
});

/** A signed-in browser session for a user created through the real sign-in route. */
async function browserSession(email: string) {
  const res = await signInRoute(req("/api/v1/auth/sign-in", { body: { email, password: "correct horse battery staple" }, xff: "192.0.2.1" }), params({}));
  expect(res.status).toBe(200);
  return sessionCookie(res);
}

async function ownerWithOrg() {
  const owner = await makeUser({ name: "Owner Person" });
  const org = await createOrganization(owner.ctx, { name: `Org ${Math.random().toString(36).slice(2, 7)}` });
  // MFA-fresh browser session for the owner (role grants are MFA-gated).
  const cookie = await browserSession(owner.user.email);
  await db().session.updateMany({ where: { userId: owner.user.id }, data: { mfaVerifiedAt: new Date() } });
  return { owner, org, cookie };
}

async function invite(cookie: string, orgId: string, email: string, roleKey = "VIEWER") {
  const res = await inviteRoute(req(`/api/v1/organizations/${orgId}/invitations`, { cookie, body: { email, roleId: await systemRoleId(db(), roleKey) } }), params({ orgId }));
  return { res, json: await res.json() };
}

describe("invitation email delivery", () => {
  it("reports NOT_CONFIGURED truthfully when no email provider is configured", async () => {
    setEmailProviderForTests(null);
    const { org, cookie } = await ownerWithOrg();
    const { res, json } = await invite(cookie, org.id, "nc@example.test");
    expect(res.status).toBe(200);
    expect(json.delivery).toBe("NOT_CONFIGURED");
    expect(json.token).toBeUndefined(); // the inviter never receives the secret
    const inv = await db().invitation.findUniqueOrThrow({ where: { id: json.invitationId } });
    expect(inv.deliveryStatus).toBe("NOT_CONFIGURED");
    expect(await db().emailMessage.count({ where: { template: "invitation", status: "NOT_CONFIGURED", toEmail: "nc@example.test" } })).toBe(1);
  });

  it("records FAILED (without throwing) when the provider errors", async () => {
    setEmailProviderForTests(failing);
    const { org, cookie } = await ownerWithOrg();
    const { json } = await invite(cookie, org.id, "fail@example.test");
    expect(json.delivery).toBe("FAILED");
  });

  it("emails a fragment link; the raw token is stored nowhere; acceptance is single-use and addressee-bound", async () => {
    setEmailProviderForTests(capturing);
    const { org, cookie } = await ownerWithOrg();
    const invitee = await makeUser();
    const { json } = await invite(cookie, org.id, invitee.user.email);
    expect(json.delivery).toBe("SENT");
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe(invitee.user.email);
    expect(outbox[0]!.text).toMatch(/\/invite#token=/);
    const token = tokenFrom(outbox[0]!);

    const inv = await db().invitation.findUniqueOrThrow({ where: { id: json.invitationId } });
    expect(inv.tokenHash).not.toContain(token);
    const logRow = await db().emailMessage.findFirstOrThrow({ where: { template: "invitation", toEmail: invitee.user.email } });
    expect(JSON.stringify(logRow)).not.toContain(token);

    const stranger = await makeUser();
    const strangerCookie = await browserSession(stranger.user.email);
    const wrong = await acceptRoute(req("/api/v1/invitations/accept", { cookie: strangerCookie, body: { token } }), params({}));
    expect(wrong.status).toBe(403);

    const inviteeCookie = await browserSession(invitee.user.email);
    const ok = await acceptRoute(req("/api/v1/invitations/accept", { cookie: inviteeCookie, body: { token } }), params({}));
    expect(ok.status).toBe(200);
    expect((await ok.json()).organizationId).toBe(org.id);
    expect((await db().user.findUniqueOrThrow({ where: { id: invitee.user.id } })).emailVerifiedAt).not.toBeNull();
    const again = await acceptRoute(req("/api/v1/invitations/accept", { cookie: inviteeCookie, body: { token } }), params({}));
    expect(again.status).toBe(404);
  });

  it("expired, revoked and resent (rotated) tokens behave correctly", async () => {
    setEmailProviderForTests(capturing);
    const { org, cookie } = await ownerWithOrg();
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeUser();

    const ia = await invite(cookie, org.id, a.user.email);
    await db().invitation.update({ where: { id: ia.json.invitationId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await acceptRoute(req("/api/v1/invitations/accept", { cookie: await browserSession(a.user.email), body: { token: tokenFrom(outbox[0]!) } }), params({}));
    expect(expired.status).toBe(404);

    const ib = await invite(cookie, org.id, b.user.email);
    const revoked = await revokeRoute(req(`/api/v1/organizations/${org.id}/invitations/${ib.json.invitationId}`, { method: "DELETE", cookie }), params({ orgId: org.id, invitationId: ib.json.invitationId }));
    expect(revoked.status).toBe(200);
    const afterRevoke = await acceptRoute(req("/api/v1/invitations/accept", { cookie: await browserSession(b.user.email), body: { token: tokenFrom(outbox[1]!) } }), params({}));
    expect(afterRevoke.status).toBe(404);

    const ic = await invite(cookie, org.id, c.user.email);
    const oldToken = tokenFrom(outbox[2]!);
    const resent = await resendRoute(req(`/api/v1/organizations/${org.id}/invitations/${ic.json.invitationId}/resend`, { cookie }), params({ orgId: org.id, invitationId: ic.json.invitationId }));
    expect((await resent.json()).delivery).toBe("SENT");
    const newToken = tokenFrom(outbox[3]!);
    expect(newToken).not.toBe(oldToken);
    const cCookie = await browserSession(c.user.email);
    expect((await acceptRoute(req("/api/v1/invitations/accept", { cookie: cCookie, body: { token: oldToken } }), params({}))).status).toBe(404);
    expect((await acceptRoute(req("/api/v1/invitations/accept", { cookie: cCookie, body: { token: newToken } }), params({}))).status).toBe(200);
  });

  it("an invitation dies with its inviter's authority (no escalation through stale invitations)", async () => {
    setEmailProviderForTests(capturing);
    const { org, cookie } = await ownerWithOrg();
    // An org admin invites someone, then loses the admin role before acceptance.
    const admin = await makeUser();
    const ia = await invite(cookie, org.id, admin.user.email, "ORGANIZATION_ADMIN");
    const adminCookie = await browserSession(admin.user.email);
    await acceptRoute(req("/api/v1/invitations/accept", { cookie: adminCookie, body: { token: tokenFrom(outbox[0]!) } }), params({}));
    expect(ia.res.status).toBe(200);
    await db().session.updateMany({ where: { userId: admin.user.id }, data: { mfaVerifiedAt: new Date() } });
    const target = await makeUser();
    const it2 = await invite(adminCookie, org.id, target.user.email, "MANAGER");
    expect(it2.res.status).toBe(400); // MANAGER is not assignable at ORGANIZATION scope
    const it3 = await invite(adminCookie, org.id, target.user.email, "VIEWER");
    expect(it3.json.delivery).toBe("SENT");
    await db().roleAssignment.deleteMany({ where: { principalId: admin.user.id, organizationId: org.id } });

    expect(outbox).toHaveLength(2); // the rejected MANAGER invitation sent nothing
    const res = await acceptRoute(req("/api/v1/invitations/accept", { cookie: await browserSession(target.user.email), body: { token: tokenFrom(outbox[1]!) } }), params({}));
    expect(res.status).toBe(404);
    const inv = await db().invitation.findUniqueOrThrow({ where: { id: it3.json.invitationId } });
    expect(inv.revokedAt).not.toBeNull();
    expect(await db().membership.count({ where: { organizationId: org.id, userId: target.user.id } })).toBe(0);
  });

  it("members without users.manage cannot invite", async () => {
    setEmailProviderForTests(capturing);
    const { org, cookie } = await ownerWithOrg();
    const viewer = await makeUser();
    await invite(cookie, org.id, viewer.user.email);
    const vCookie = await browserSession(viewer.user.email);
    await acceptRoute(req("/api/v1/invitations/accept", { cookie: vCookie, body: { token: tokenFrom(outbox[0]!) } }), params({}));
    const { res } = await invite(vCookie, org.id, "x@example.test");
    expect(res.status).toBe(403);
  });
});

describe("password reset", () => {
  it("does not reveal whether an account exists: same status, body, headers and timing; the work happens in the worker", async () => {
    // A slow provider: if any account-dependent work ran on the request path, the known account would be ~1.5 s slower.
    setEmailProviderForTests({ id: "slow", send: async (m) => (await new Promise((r) => setTimeout(r, 1500)), outbox.push(m), { messageId: "slow-1" }) });
    const known = await makeUser();
    const ask = async (email: string, ip: string) => {
      const started = performance.now();
      const res = await forgotRoute(req("/api/v1/auth/password/forgot", { body: { email }, xff: ip }), params({}));
      return { res, ms: performance.now() - started };
    };
    await ask("warmup@example.test", "192.0.2.89"); // first-call costs (module load, queue connection)
    const a = await ask(known.user.email, "192.0.2.90");
    const b = await ask("ghost@example.test", "192.0.2.91");
    expect(a.res.status).toBe(200);
    expect(b.res.status).toBe(200);
    expect(await a.res.json()).toEqual(await b.res.json());
    // Everything but the request id and the wall-clock countdown (whole seconds; may tick between the calls).
    const headers = (r: Response) => [...r.headers].filter(([k]) => k !== "x-request-id" && k !== "ratelimit-reset").sort();
    expect(headers(a.res)).toEqual(headers(b.res));
    expect(Math.abs(Number(a.res.headers.get("ratelimit-reset")) - Number(b.res.headers.get("ratelimit-reset")))).toBeLessThanOrEqual(1);
    expect(a.ms).toBeLessThan(750);
    expect(b.ms).toBeLessThan(750);
    // Nothing account-specific happened before the response.
    expect(outbox).toHaveLength(0);
    expect(await db().passwordResetToken.count({ where: { userId: known.user.id } })).toBe(0);

    // The worker then emails only the real account; the ghost is a silent no-op.
    expect(await runQueuedPasswordResets()).toBe(3);
    expect(outbox.map((m) => m.to)).toEqual([known.user.email]);
    expect(await db().passwordResetToken.count({ where: { userId: known.user.id } })).toBe(1);
  });

  it("rate limits and validation errors are the same for existing and unknown accounts", async () => {
    setEmailProviderForTests(capturing);
    const known = await makeUser();
    const statuses = async (email: string, ipBase: number) => {
      const out: number[] = [];
      for (let i = 0; i < 4; i++) out.push((await forgotRoute(req("/api/v1/auth/password/forgot", { body: { email }, xff: `198.51.100.${ipBase + i}` }), params({}))).status);
      return out;
    };
    // Per-account limit (3/h) counts hashed addresses, whether or not an account exists.
    expect(await statuses(known.user.email, 10)).toEqual([200, 200, 200, 429]);
    expect(await statuses("nobody-here@example.test", 20)).toEqual([200, 200, 200, 429]);
    const bad = await forgotRoute(req("/api/v1/auth/password/forgot", { body: { email: "not-an-email" }, xff: "198.51.100.40" }), params({}));
    expect(bad.status).toBe(400);
    await clearJobQueues();
  });

  it("if the job queue is unreachable, every request gets the same retryable 503", async () => {
    const known = await makeUser();
    await authEmailQueue().disconnect();
    try {
      const a = await forgotRoute(req("/api/v1/auth/password/forgot", { body: { email: known.user.email }, xff: "198.51.100.60" }), params({}));
      const b = await forgotRoute(req("/api/v1/auth/password/forgot", { body: { email: "ghost2@example.test" }, xff: "198.51.100.61" }), params({}));
      expect([a.status, b.status]).toEqual([503, 503]);
      expect((await a.json()).error.code).toBe("service_unavailable");
      expect((await b.json()).error.code).toBe("service_unavailable");
    } finally {
      await resetJobQueuesForTests();
    }
  });

  it("is single-use, expires, rejects the old password and revokes every session", async () => {
    setEmailProviderForTests(capturing);
    const u = await makeUser();
    const ctx = systemContext();
    const login = await signIn(ctx, { email: u.user.email, password: "correct horse battery staple" });
    await requestPasswordReset(ctx, { email: u.user.email });
    await runQueuedPasswordResets();
    const token = tokenFrom(outbox[0]!);
    expect(outbox[0]!.text).toMatch(/\/reset-password#token=/);

    await expectCode(resetPassword(ctx, { token, password: "correct horse battery staple" }), "validation_error");
    await resetPassword(ctx, { token, password: "a brand new passphrase" });
    expect(await validateSessionToken(login.token)).toBeNull();
    await expectCode(resetPassword(ctx, { token, password: "another new passphrase" }), "validation_error");
    await signIn(ctx, { email: u.user.email, password: "a brand new passphrase" });

    await requestPasswordReset(ctx, { email: u.user.email });
    await runQueuedPasswordResets();
    await db().passwordResetToken.updateMany({ where: { userId: u.user.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1) } });
    await expectCode(resetPassword(ctx, { token: tokenFrom(outbox[1]!), password: "yet another passphrase" }), "validation_error");
  });

  it("a provider failure is retried by the queue; each retry voids the previous link", async () => {
    const u = await makeUser();
    setEmailProviderForTests(failing);
    await requestPasswordReset(systemContext(), { email: u.user.email });
    const [job] = await authEmailQueue().getJobs(["waiting"]);
    await expect(processPasswordResetRequest(job!.data)).rejects.toThrow(/delivery failed/); // → BullMQ retries
    expect(await db().emailMessage.count({ where: { userId: u.user.id, template: "password_reset", status: "FAILED" } })).toBe(1);
    setEmailProviderForTests(capturing);
    await processPasswordResetRequest(job!.data); // the retry
    await job!.remove();
    expect(await db().passwordResetToken.count({ where: { userId: u.user.id, usedAt: null } })).toBe(1);
    expect(outbox).toHaveLength(1);
  });

  it("reports not_configured instead of claiming an email was sent", async () => {
    setEmailProviderForTests(null);
    const u = await makeUser();
    expect(await requestPasswordReset(systemContext(), { email: u.user.email })).toEqual({ emailDelivery: "not_configured" });
    await runQueuedPasswordResets();
    expect(await db().emailMessage.findFirstOrThrow({ where: { userId: u.user.id, template: "password_reset" } })).toMatchObject({ status: "NOT_CONFIGURED" });
  });
});

describe("email verification", () => {
  it("verifies once, and a token for a superseded address is rejected", async () => {
    setEmailProviderForTests(capturing);
    const u = await makeUser();
    expect((await sendEmailVerification(u.user.id)).status).toBe("SENT");
    const token = tokenFrom(outbox[0]!);
    await verifyEmail(u.ctx, token);
    expect((await db().user.findUniqueOrThrow({ where: { id: u.user.id } })).emailVerifiedAt).not.toBeNull();
    await expectCode(verifyEmail(u.ctx, token), "validation_error");

    const v = await makeUser();
    await sendEmailVerification(v.user.id);
    await db().user.update({ where: { id: v.user.id }, data: { email: `changed-${v.user.email}` } });
    await expectCode(verifyEmail(v.ctx, tokenFrom(outbox[1]!)), "validation_error");
  });

  it("is bound to the signed-in account: inbox access alone cannot confirm someone else's registration", async () => {
    setEmailProviderForTests(capturing);
    // An attacker registers the victim's address; the verification link lands in the victim's inbox.
    const squatter = await makeUser();
    await sendEmailVerification(squatter.user.id);
    const token = tokenFrom(outbox[0]!);
    const noSession = await verifyRoute(req("/api/v1/auth/email/verify", { body: { token }, xff: "198.51.100.70" }), params({}));
    expect(noSession.status).toBe(401);
    const someoneElse = await makeUser();
    await expectCode(verifyEmail(someoneElse.ctx, token), "validation_error");
    expect((await db().user.findUniqueOrThrow({ where: { id: squatter.user.id } })).emailVerifiedAt).toBeNull();
  });
});

describe("email rendering", () => {
  it("escapes HTML in variables and renders Arabic right-to-left", () => {
    const m = renderEmail("invitation", "ar-AE", { inviter: "<script>x</script>", organization: "Acme & Co", role: "Viewer" }, "https://app.realy.si/ar-AE/invite#token=abc");
    expect(m.html).not.toContain("<script>x</script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain('dir="rtl"');
    expect(m.subject).toContain("Acme & Co");
  });
});
