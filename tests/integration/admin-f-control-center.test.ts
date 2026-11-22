import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { userContext, type RequestContext } from "@/server/core/context";
import { consume, resetMemoryLimiter } from "@/server/core/rate-limit";
import { createOrganization } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { createApiKey } from "@/server/modules/enterprise/api-keys";
import { apiKeyDetail, restrictApiKey, setApiKeyDisabled } from "@/server/modules/admin/developers";
import { assignTicket, createPlatformTicket, customerHealth, escalateTicket, getMyPlatformTicket, replyMyPlatformTicket, replyTicket, setTicketStatus, supportQueue } from "@/server/modules/admin/support";
import { receiveEmailWebhook } from "@/server/modules/email/events";
import { sendEmail } from "@/server/modules/email/service";
import { setEmailProviderForTests } from "@/server/modules/email/provider";
import { addSuppression, listEmailMessages, removeSuppression } from "@/server/modules/admin/email-admin";
import { decideFileDeletion, requestFileDeletion } from "@/server/modules/admin/files-admin";
import { createFlag, isEnabled, rollbackFlag, setFlagKilled, setFlagRollout } from "@/server/modules/flags/service";
import { getAuditEntry, searchAudit } from "@/server/modules/admin/security";
import { setWebhookPaused } from "@/server/modules/admin/webhooks-admin";
import { platformSearch } from "@/server/modules/admin/search/providers/platform";
import { PLATFORM_ID } from "@/server/modules/rbac/scope";
import { expectCode, grant, makeUser, resetDb } from "../helpers";

// Stream F: platform support, API keys, email events + suppression, file deletion (four eyes), flags v2, audit detail,
// webhook pause, rate-limit events, global search.

const F_TABLES = ["platform_support_messages", "platform_support_tickets", "email_events", "email_suppressions", "rate_limit_events", "api_request_logs", "feature_flag_rollouts", "feature_flag_versions", "file_deletion_requests"];

let staff: RequestContext;
let staff2: RequestContext;
let owner: Awaited<ReturnType<typeof makeUser>>;
let orgId: string;
let companyId: string;

const admin = async (role = "SUPER_ADMIN") => {
  const u = await makeUser({ name: "Realy Staff" });
  await grant(u.user.id, role, "PLATFORM", PLATFORM_ID);
  return userContext(u.user.id, { mfaVerifiedAt: new Date(), sessionId: randomUUID() });
};

beforeAll(async () => {
  await resetDb();
  for (const t of F_TABLES) await db().$executeRawUnsafe(`DELETE FROM "${t}"`);
  await db().featureFlag.deleteMany({ where: { key: { startsWith: "f.test." } } });
  owner = await makeUser({ name: "Owner" });
  const org = await createOrganization(owner.ctx, { name: `F org ${Math.random()}` });
  orgId = org.id;
  companyId = (await createCompany(owner.ctx, org.id, { name: "F Co" })).id;
  staff = await admin();
  staff2 = await admin();
});
afterAll(() => setEmailProviderForTests(undefined));

describe("platform support center", () => {
  it("customer opens, staff works the ticket, internal notes stay internal", async () => {
    const t = await createPlatformTicket(owner.ctx, { subject: "Invoice wrong", body: "Please check", category: "billing", organizationId: orgId });
    // Customers never see another person's ticket.
    const stranger = await makeUser();
    await expectCode(getMyPlatformTicket(stranger.ctx, t.id), "not_found");
    await expectCode(supportQueue(owner.ctx), "forbidden");

    const q = await supportQueue(staff, { assignee: "none" });
    expect(q.data.map((x) => x.id)).toContain(t.id);
    await assignTicket(staff, t.id, { assigneeId: staff.actor.id });
    await expectCode(assignTicket(staff, t.id, { assigneeId: owner.user.id }), "validation_error");

    setEmailProviderForTests(null);
    const note = await replyTicket(staff, t.id, { body: "Customer is on legacy plan", internal: true });
    expect(note.email).toBeNull();
    const reply = await replyTicket(staff, t.id, { body: "Fixed, please confirm" });
    expect(reply.email).toBe("NOT_CONFIGURED"); // never claimed as sent

    const mine = await getMyPlatformTicket(owner.ctx, t.id);
    expect(mine.messages.map((m) => m.body)).toEqual(["Please check", "Fixed, please confirm"]);
    expect(mine.ticket.status).toBe("PENDING_CUSTOMER");
    await replyMyPlatformTicket(owner.ctx, t.id, { body: "Still wrong" });

    const esc = await escalateTicket(staff, t.id, { reason: "VIP customer escalation" });
    expect(esc).toMatchObject({ escalationLevel: 1, priority: "HIGH" });
    await expectCode(setTicketStatus(staff, t.id, { status: "CLOSED" }), "validation_error"); // reason required
    await setTicketStatus(staff, t.id, { status: "CLOSED", reason: "resolved by billing" });
    await expectCode(replyMyPlatformTicket(owner.ctx, t.id, { body: "again" }), "conflict");
    const audits = await db().auditLog.findMany({ where: { resourceType: "platform_support_ticket", resourceId: t.id } });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["platform_support.ticket_created", "platform_support.assigned", "platform_support.escalated", "platform_support.closed"]));

    const health = await customerHealth(staff, orgId);
    expect(health.support.total).toBe(1);
    expect(health.usage.members).toBe(1);
  });
});

describe("API key admin actions", () => {
  it("disables, restricts (never widens) and shows detail without the secret", async () => {
    const k = await createApiKey(owner.ctx, orgId, { name: "ci", scopes: ["companies.read", "audit.read"], expiresInDays: null });
    await setApiKeyDisabled(staff, k.id, { disabled: true, reason: "suspicious traffic" });
    expect((await apiKeyDetail(staff, k.id)).key.state).toBe("disabled");
    await expectCode(restrictApiKey(staff, k.id, { scopes: ["companies.read", "finance.read"], reason: "narrow it" }), "validation_error");
    const r = await restrictApiKey(staff, k.id, { scopes: ["companies.read"], expiresInDays: 7, reason: "rotate soon" });
    expect(r.scopes).toEqual(["companies.read"]);
    await expectCode(restrictApiKey(staff, k.id, { expiresInDays: 30, reason: "later expiry" }), "validation_error");
    const d = await apiKeyDetail(staff, k.id);
    expect(JSON.stringify(d)).not.toContain(k.secret);
    expect(d.scopes).toEqual(["companies.read"]);
    await expectCode(setApiKeyDisabled(owner.ctx, k.id, { disabled: false, reason: "nope nope" }), "forbidden");
  });
});

describe("email events and suppression", () => {
  it("stores signed events, suppresses hard bounces and blocks the next send", async () => {
    const sent: string[] = [];
    setEmailProviderForTests({ id: "resend", send: async (m) => (sent.push(m.to), { messageId: "re_msg_1" }) });
    await sendEmail({ to: "bounce@example.test", template: "verify_email", locale: "en-US", vars: { name: "A" }, link: "https://x" });
    process.env.EMAIL_WEBHOOK_SECRET_RESEND = `whsec_${Buffer.from("test-signing-secret-123").toString("base64")}`;
    const body = JSON.stringify({ type: "email.bounced", created_at: new Date().toISOString(), data: { email_id: "re_msg_1", to: ["bounce@example.test"], bounce: { type: "Permanent" } } });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", Buffer.from(process.env.EMAIL_WEBHOOK_SECRET_RESEND.slice(6), "base64")).update(`m1.${ts}.${body}`).digest("base64");
    await expectCode(receiveEmailWebhook("resend", body, new Headers({ "svix-id": "m1", "svix-timestamp": ts, "svix-signature": "v1,bad" })), "unauthenticated");
    const r = await receiveEmailWebhook("resend", body, new Headers({ "svix-id": "m1", "svix-timestamp": ts, "svix-signature": `v1,${sig}` }));
    expect(r).toMatchObject({ stored: true, type: "bounced", suppressed: true });
    // Redelivery is idempotent.
    expect((await receiveEmailWebhook("resend", body, new Headers({ "svix-id": "m1", "svix-timestamp": ts, "svix-signature": `v1,${sig}` }))).stored).toBe(false);
    const res = await sendEmail({ to: "Bounce@example.test", template: "verify_email", locale: "en-US", vars: { name: "A" }, link: "https://x" });
    expect(res.status).toBe("FAILED");
    expect(sent).toEqual(["bounce@example.test"]);
    const log = await listEmailMessages(staff, { outcome: "bounced" });
    expect(log.data[0]?.outcome).toBe("bounced");
    await removeSuppression(staff, "bounce@example.test", { reason: "mailbox fixed" });
    await addSuppression(staff, { email: "manual@example.test", reason: "asked to stop" });
    await expectCode(addSuppression(staff, { email: "manual@example.test", reason: "asked to stop" }), "conflict");
    delete process.env.EMAIL_WEBHOOK_SECRET_RESEND;
    await expectCode(receiveEmailWebhook("resend", body, new Headers()), "not_configured");
  });
});

describe("file deletion needs a second admin", () => {
  it("refuses self-approval and deletes on another admin's approval", async () => {
    const o = await db().integrationStoredObject.create({ data: { organizationId: orgId, companyId, key: "exports/a.csv", contentType: "text/csv", size: 3, data: Buffer.from("a,b") } });
    const req = await requestFileDeletion(staff, { store: "integration_stored_object", fileId: o.id, reason: "GDPR erasure request" });
    await expectCode(decideFileDeletion(staff, req.id, { decision: "approve", reason: "self approve", confirm: "DELETE FILE" }), "forbidden");
    await expectCode(decideFileDeletion(staff2, req.id, { decision: "approve", reason: "approved", confirm: "nope" }), "conflict");
    await decideFileDeletion(staff2, req.id, { decision: "approve", reason: "approved per ticket", confirm: "DELETE FILE" });
    expect(await db().integrationStoredObject.findUnique({ where: { id: o.id } })).toBeNull();
    await expectCode(decideFileDeletion(staff2, req.id, { decision: "reject", reason: "too late" }), "conflict");
  });
});

describe("feature flags v2", () => {
  it("creates, rolls out, kills and rolls back with versions", async () => {
    const f = await createFlag(staff, { key: "f.test.rollout", reason: "new beta feature" });
    await setFlagRollout(staff, f.id, { percentage: 100, environments: [], reason: "everyone" });
    expect(await isEnabled("f.test.rollout", { userId: "u1" })).toBe(true);
    await setFlagKilled(staff, f.id, { killed: true, reason: "incident" });
    expect(await isEnabled("f.test.rollout", { userId: "u1" })).toBe(false);
    await rollbackFlag(staff, f.id, { version: 2, reason: "back to rollout" });
    expect(await isEnabled("f.test.rollout", { userId: "u1" })).toBe(true);
    const versions = await db().featureFlagVersion.findMany({ where: { flagId: f.id }, orderBy: { version: "asc" } });
    expect(versions.map((v) => v.action)).toEqual(["created", "rollout_set", "killed", "rolled_back_to_v2"]);
  });
});

describe("audit, webhooks, rate limits, search", () => {
  it("shows one audit record with request siblings and filters by request id", async () => {
    const row = await db().auditLog.findFirstOrThrow({ where: { action: "feature_flag.killed" } });
    const e = await getAuditEntry(staff, row.id);
    expect(e.entry.id).toBe(row.id);
    const byReq = await searchAudit(staff, { requestId: row.requestId!, scope: "all" });
    expect(byReq.data.map((a) => a.id)).toContain(row.id);
  });

  it("pauses an endpoint and parks pending retries", async () => {
    const sub = await db().integrationWebhookSubscription.create({ data: { organizationId: orgId, companyId, name: "hook", url: "https://example.test/h", eventTypes: ["*"], secretEnc: "x", createdById: owner.user.id } });
    const d = await db().integrationWebhookDelivery.create({ data: { organizationId: orgId, companyId, subscriptionId: sub.id, eventId: randomUUID(), eventType: "crm.contact.created", payload: {}, nextAttemptAt: new Date() } });
    await setWebhookPaused(staff, sub.id, { paused: true, reason: "customer endpoint down" });
    expect((await db().integrationWebhookDelivery.findUniqueOrThrow({ where: { id: d.id } })).nextAttemptAt).toBeNull();
    await setWebhookPaused(staff, sub.id, { paused: false, reason: "endpoint is back" });
    expect((await db().integrationWebhookDelivery.findUniqueOrThrow({ where: { id: d.id } })).nextAttemptAt).not.toBeNull();
  });

  it("records one rate-limit event per refused rule, subject and window", async () => {
    resetMemoryLimiter();
    const rule = { name: `f-test-${Date.now()}:ip`, limit: 1, windowMs: 60_000 };
    for (let i = 0; i < 4; i++) await consume(rule, "203.0.113.9");
    await new Promise((r) => setTimeout(r, 200));
    const rows = await db().rateLimitEvent.findMany({ where: { rule: rule.name } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.keyHash).not.toContain("203.0.113.9");
  });

  it("global search finds tickets and flags for staff only", async () => {
    const r = await platformSearch.search(staff, "f.test");
    expect(r.flags.map((f) => f.key)).toContain("f.test.rollout");
    const t = await platformSearch.search(staff, "Invoice");
    expect(t.tickets).toHaveLength(1);
  });
});
