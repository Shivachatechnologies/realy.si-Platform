import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/server/core/db";
import { hmacSha256 } from "@/server/core/crypto";
import { resetEnvCache } from "@/server/core/env";
import { createOrganization } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { PLATFORM_ID } from "@/server/modules/rbac/scope";
import { decryptCredentials, encryptCredentials, getConnection } from "@/server/modules/integrations/connections";
import { assertWhatsAppNumberFree, connectionForPhoneNumberId, connectionsForStripeAccount } from "@/server/modules/integrations/own-accounts";
import { receiveRazorpayPartnerWebhook, receiveStripeConnectWebhook, receiveWhatsAppAppWebhook } from "@/server/modules/integrations/own-account-webhooks";
import { adminOwnAccountStatus, adminRemoveOwnAccount, adminSetOwnAccountCredentials } from "@/server/modules/admin/org-integrations";
import { disconnectIntegration, getIntegration } from "@/server/modules/integrations/service";
import { expectCode, grant, makeUser, raiseLimits, resetDb } from "../helpers";

/**
 * The customer's own Stripe / Razorpay / WhatsApp / Mailchimp accounts (docs/integrations.md §7): platform webhooks
 * routed to the right company by connected account id and phone_number_id, deauthorization, and the Realy team's
 * admin setup (MFA-gated, audited, write-only).
 */

beforeAll(resetDb);

const set: string[] = [];
const setEnv = (k: string, v: string) => {
  set.push(k);
  process.env[k] = v;
  resetEnvCache();
};
afterEach(() => {
  for (const k of set.splice(0)) delete process.env[k];
  resetEnvCache();
  vi.unstubAllGlobals();
});

async function tenant(name: string) {
  const owner = await makeUser({ name });
  const org = await createOrganization(owner.ctx, { name: `${name} ${Math.random()}` });
  await raiseLimits(org.id, { "companies.max": 3 });
  const company = await createCompany(owner.ctx, org.id, { name: `${name} Co`, incorporationCountryCode: "SI" });
  return { owner, org, company };
}

async function connect(t: Awaited<ReturnType<typeof tenant>>, provider: string, config: Record<string, unknown>, creds: { accessToken?: string; apiKey?: string } = { accessToken: `tok-${provider}-${t.company.id.slice(0, 6)}` }) {
  return db().integrationConnection.create({
    data: {
      organizationId: t.org.id,
      companyId: t.company.id,
      provider,
      status: "CONNECTED",
      credentialsEnc: encryptCredentials(t.company.id, provider, creds),
      config: config as object,
      connectedById: t.owner.user.id,
      syncEnabled: provider === "stripe",
    },
  });
}

const stripeSign = (secret: string, raw: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${hmacSha256(secret, `${t}.${raw}`).toString("hex")}`;
const metaSign = (secret: string, raw: string) => `sha256=${hmacSha256(secret, raw).toString("hex")}`;

describe("Stripe Connect webhooks are routed by connected account", () => {
  it("delivers to the company that connected the account, never to another tenant", async () => {
    const a = await tenant("Alpha");
    const b = await tenant("Beta");
    const ca = await connect(a, "stripe", { stripeAccountId: "acct_1AAAAAAAAA", authMode: "connect" });
    await connect(b, "stripe", { stripeAccountId: "acct_1BBBBBBBBB", authMode: "connect" });
    expect((await connectionsForStripeAccount("acct_1AAAAAAAAA")).map((r) => r.companyId)).toEqual([a.company.id]);
    expect(await connectionsForStripeAccount("acct_unknown1")).toEqual([]);
    expect(await connectionsForStripeAccount("not-an-account")).toEqual([]);

    setEnv("STRIPE_CONNECT_WEBHOOK_SECRET", "whsec_connecttestsecret");
    const event = { id: "evt_1", type: "checkout.session.completed", account: "acct_1AAAAAAAAA", livemode: false, data: { object: { object: "checkout.session", id: "cs_1", amount_total: 1500, currency: "eur", status: "complete" } } };
    const raw = JSON.stringify(event);
    // Unsigned / wrongly signed: refused.
    expect((await receiveStripeConnectWebhook(raw, null)).status).toBe(400);
    expect((await receiveStripeConnectWebhook(raw, stripeSign("whsec_other", raw))).status).toBe(400);
    // Realy's billing secret does not verify Connect events (separate endpoints and secrets).
    setEnv("STRIPE_WEBHOOK_SECRET", "whsec_billingsecret");
    expect((await receiveStripeConnectWebhook(raw, stripeSign("whsec_billingsecret", raw))).status).toBe(400);

    const ok = await receiveStripeConnectWebhook(raw, stripeSign("whsec_connecttestsecret", raw));
    expect(ok).toMatchObject({ status: 200, body: { routed: 1 } });
    const events = await db().integrationProviderEvent.findMany({ where: { provider: "stripe" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ companyId: a.company.id, connectionId: ca.id, eventType: "checkout.session.completed", dedupeKey: "evt_1", status: "processed" });
    // A payment schedules the company's own stripe.payments sync right away.
    expect((await db().integrationConnection.findUniqueOrThrow({ where: { id: ca.id } })).nextSyncAt).not.toBeNull();
    // Redelivery is deduplicated; an unknown account is acknowledged and dropped.
    await receiveStripeConnectWebhook(raw, stripeSign("whsec_connecttestsecret", raw));
    expect(await db().integrationProviderEvent.count({ where: { provider: "stripe" } })).toBe(1);
    const stray = JSON.stringify({ ...event, id: "evt_2", account: "acct_1ZZZZZZZZZ" });
    expect(await receiveStripeConnectWebhook(stray, stripeSign("whsec_connecttestsecret", stray))).toMatchObject({ status: 200, body: { routed: 0 } });
    expect(await db().integrationProviderEvent.count({ where: { companyId: b.company.id } })).toBe(0);
  });

  it("account.application.deauthorized disconnects the connection and wipes its credentials", async () => {
    const a = await tenant("Gamma");
    const conn = await connect(a, "stripe", { stripeAccountId: "acct_1GGGGGGGGG", authMode: "connect" });
    setEnv("STRIPE_CONNECT_WEBHOOK_SECRET", "whsec_connecttestsecret");
    const raw = JSON.stringify({ id: "evt_d", type: "account.application.deauthorized", account: "acct_1GGGGGGGGG", data: { object: { id: "ca_x" } } });
    expect((await receiveStripeConnectWebhook(raw, stripeSign("whsec_connecttestsecret", raw))).status).toBe(200);
    const row = await db().integrationConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(row.status).toBe("DISCONNECTED");
    expect(row.credentialsEnc).toBeNull();
    expect(await getConnection(a.org.id, a.company.id, "stripe")).toBeNull();
    expect(await db().auditLog.count({ where: { action: "integration.deauthorized", resourceId: conn.id } })).toBe(1);
  });
});

describe("Razorpay partner webhooks are routed by account_id", () => {
  it("routes payments and handles revoked authorization", async () => {
    const a = await tenant("Delta");
    const conn = await connect(a, "razorpay", { razorpayAccountId: "acc_DDDDDDDDDD", authMode: "oauth" });
    setEnv("RAZORPAY_WEBHOOK_SECRET", "razorpay-partner-secret");
    const raw = JSON.stringify({ event: "payment_link.paid", account_id: "acc_DDDDDDDDDD", created_at: 1700000000, payload: { payment_link: { entity: { id: "plink_1", status: "paid", amount: 50000, currency: "INR" } } } });
    expect((await receiveRazorpayPartnerWebhook(raw, "00")).status).toBe(400);
    const sig = hmacSha256("razorpay-partner-secret", raw).toString("hex");
    expect(await receiveRazorpayPartnerWebhook(raw, sig)).toMatchObject({ status: 200, body: { routed: 1 } });
    expect(await db().integrationProviderEvent.findFirst({ where: { connectionId: conn.id } })).toMatchObject({ eventType: "payment_link.paid", status: "processed" });
    const revoke = JSON.stringify({ event: "account.app.authorization_revoked", account_id: "acc_DDDDDDDDDD", payload: {} });
    await receiveRazorpayPartnerWebhook(revoke, hmacSha256("razorpay-partner-secret", revoke).toString("hex"));
    expect((await db().integrationConnection.findUniqueOrThrow({ where: { id: conn.id } })).status).toBe("DISCONNECTED");
  });
});

describe("WhatsApp app webhooks are routed by phone_number_id", () => {
  it("splits one delivery between the companies that own each number", async () => {
    const a = await tenant("Echo");
    const b = await tenant("Foxtrot");
    const ca = await connect(a, "whatsapp", { phoneNumberId: "100000000001", businessAccountId: "900000000001", authMode: "embedded_signup" });
    const cb = await connect(b, "whatsapp", { phoneNumberId: "100000000002", businessAccountId: "900000000002", authMode: "embedded_signup" });
    expect((await connectionForPhoneNumberId("100000000001"))?.companyId).toBe(a.company.id);
    expect(await connectionForPhoneNumberId("100000000099")).toBeNull();

    setEnv("WHATSAPP_APP_SECRET", "b".repeat(32));
    const change = (phone: string, id: string) => ({ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: phone }, messages: [{ id, from: "38640111222", type: "text", text: { body: `hello ${id}` } }] } });
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "900000000001", changes: [change("100000000001", "wamid.A1")] }, { id: "900000000002", changes: [change("100000000002", "wamid.B1"), change("100000000099", "wamid.X1")] }] });
    expect((await receiveWhatsAppAppWebhook(raw, null)).result.status).toBe(401);
    expect((await receiveWhatsAppAppWebhook(raw, metaSign("c".repeat(32), raw))).result.status).toBe(401);
    const { result, routed } = await receiveWhatsAppAppWebhook(raw, metaSign("b".repeat(32), raw));
    expect(result).toMatchObject({ status: 200, body: { routed: 2 } });
    const byCompany = new Map(routed.map((r) => [r.companyId, r]));
    expect(JSON.stringify(byCompany.get(a.company.id)!.body)).toContain("wamid.A1");
    expect(JSON.stringify(byCompany.get(a.company.id)!.body)).not.toContain("wamid.B1");
    expect(JSON.stringify(byCompany.get(b.company.id)!.body)).toContain("wamid.B1");
    expect(JSON.stringify(byCompany.get(b.company.id)!.body)).not.toContain("wamid.A1");
    expect(JSON.stringify(routed)).not.toContain("wamid.X1");
    expect(await db().integrationProviderEvent.findMany({ where: { provider: "whatsapp" }, select: { connectionId: true, eventType: true } })).toEqual(
      expect.arrayContaining([
        { connectionId: ca.id, eventType: "messages" },
        { connectionId: cb.id, eventType: "messages" },
      ]),
    );
    expect(await db().integrationProviderEvent.count({ where: { provider: "whatsapp" } })).toBe(2);
  });

  it("a phone number can belong to one company only", async () => {
    const a = await tenant("Golf");
    const b = await tenant("Hotel");
    await connect(a, "whatsapp", { phoneNumberId: "100000000077" });
    await expectCode(assertWhatsAppNumberFree(b.company.id, "100000000077"), "conflict");
    await assertWhatsAppNumberFree(a.company.id, "100000000077"); // reconnecting the same company is fine
  });
});

describe("Realy-team setup of an organization's own accounts", () => {
  const MC_KEY = "0123456789abcdef".repeat(2) + "-us21"; // built at runtime: not a real key
  const fakeMailchimp = () =>
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url === "https://us21.api.mailchimp.com/3.0/ping") return new Response(JSON.stringify({ health_status: "Everything's Chimpy!" }), { status: 200 });
      if (url.startsWith("https://us21.api.mailchimp.com/3.0/lists")) return new Response(JSON.stringify({ lists: [{ id: "aud1", name: "Customers" }] }), { status: 200 });
      return new Response("{}", { status: 404 });
    });

  it("needs an MFA-gated platform permission", async () => {
    const t = await tenant("India");
    // The organization's own owner is not a platform admin.
    await expectCode(adminSetOwnAccountCredentials(t.owner.ctx, t.org.id, "mailchimp", { companyId: t.company.id, fields: { apiKey: MC_KEY }, reason: "customer asked" }), "forbidden");
    const noMfa = await makeUser({ mfa: false });
    await grant(noMfa.user.id, "SUPER_ADMIN", "PLATFORM", PLATFORM_ID);
    await expectCode(adminSetOwnAccountCredentials(noMfa.ctx, t.org.id, "mailchimp", { companyId: t.company.id, fields: { apiKey: MC_KEY }, reason: "customer asked" }), "mfa_required");
  });

  it("verifies, stores encrypted, audits with a reason and never returns the secret; the customer sees 'Set up by Realy team'", async () => {
    const t = await tenant("Juliet");
    const admin = await makeUser({ name: "Realy Ops" });
    await grant(admin.user.id, "SUPER_ADMIN", "PLATFORM", PLATFORM_ID);
    // A reason is mandatory; a rejected key stores nothing.
    await expect(adminSetOwnAccountCredentials(admin.ctx, t.org.id, "mailchimp", { companyId: t.company.id, fields: { apiKey: MC_KEY }, reason: "" })).rejects.toThrow();
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    await expectCode(adminSetOwnAccountCredentials(admin.ctx, t.org.id, "mailchimp", { companyId: t.company.id, fields: { apiKey: MC_KEY }, reason: "customer asked by phone" }), "validation_error");
    expect(await db().integrationConnection.count({ where: { companyId: t.company.id, provider: "mailchimp" } })).toBe(0);

    fakeMailchimp();
    const r = await adminSetOwnAccountCredentials(admin.ctx, t.org.id, "mailchimp", { companyId: t.company.id, fields: { apiKey: MC_KEY }, reason: "customer asked by phone" });
    expect(r).toMatchObject({ status: "CONNECTED", rotated: false });
    expect(JSON.stringify(r)).not.toContain(MC_KEY);
    const row = await db().integrationConnection.findUniqueOrThrow({ where: { id: r.connectionId } });
    expect(row.config).toMatchObject({ setupBy: "realy_team", authMode: "key", serverPrefix: "us21" });
    expect(JSON.stringify(row.config)).not.toContain(MC_KEY);
    expect(row.credentialsEnc).not.toContain(MC_KEY);
    expect(decryptCredentials(t.company.id, "mailchimp", row.credentialsEnc).apiKey).toBe(MC_KEY);
    const audit = await db().auditLog.findFirstOrThrow({ where: { action: "platform.integration_credentials_set", resourceId: r.connectionId } });
    expect(audit.reason).toBe("customer asked by phone");
    expect(JSON.stringify(audit)).not.toContain(MC_KEY);
    expect(JSON.stringify(audit.newValue)).toContain("apiKey");

    // Runtime calls use the organization's own account.
    const conn = await getConnection(t.org.id, t.company.id, "mailchimp");
    expect(conn).toMatchObject({ accessToken: MC_KEY, status: "CONNECTED" });
    expect(conn!.platform).toBeUndefined();
    // Status for the admin and the customer: no secrets, "set up by Realy team".
    const status = await adminOwnAccountStatus(admin.ctx, t.org.id);
    expect(status.companies[0]!.providers.find((p) => p.provider === "mailchimp")).toMatchObject({ status: "CONNECTED", setupBy: "realy_team" });
    expect(JSON.stringify(status)).not.toContain(MC_KEY);
    const customerView = await getIntegration(t.owner.ctx, t.org.id, t.company.id, "mailchimp");
    expect(customerView.platform).toBeNull();
    expect(customerView.connection?.config).toMatchObject({ setupBy: "realy_team" });
    expect(JSON.stringify(customerView)).not.toContain(MC_KEY);

    // Rotation is audited as such; removal needs a reason and disconnects.
    const rotated = await adminSetOwnAccountCredentials(admin.ctx, t.org.id, "mailchimp", { companyId: t.company.id, fields: { apiKey: MC_KEY }, reason: "rotate after leak drill" });
    expect(rotated.rotated).toBe(true);
    expect(await db().auditLog.count({ where: { action: "platform.integration_credentials_rotated", resourceId: r.connectionId } })).toBe(1);
    await expect(adminRemoveOwnAccount(admin.ctx, t.org.id, r.connectionId, {})).rejects.toThrow();
    await adminRemoveOwnAccount(admin.ctx, t.org.id, r.connectionId, { reason: "customer cancelled" });
    expect((await db().integrationConnection.findUniqueOrThrow({ where: { id: r.connectionId } })).status).toBe("DISCONNECTED");
    expect(await db().auditLog.count({ where: { action: "platform.integration_credentials_removed", resourceId: r.connectionId, reason: "customer cancelled" } })).toBe(1);
  });

  it("the customer can disconnect an account the Realy team set up", async () => {
    const t = await tenant("Kilo");
    const admin = await makeUser();
    await grant(admin.user.id, "SUPER_ADMIN", "PLATFORM", PLATFORM_ID);
    fakeMailchimp();
    const r = await adminSetOwnAccountCredentials(admin.ctx, t.org.id, "mailchimp", { companyId: t.company.id, fields: { apiKey: MC_KEY }, reason: "setup for customer" });
    await disconnectIntegration(t.owner.ctx, t.org.id, t.company.id, "mailchimp");
    expect((await db().integrationConnection.findUniqueOrThrow({ where: { id: r.connectionId } })).credentialsEnc).toBeNull();
  });

  it("refuses a WhatsApp number another company already uses", async () => {
    const a = await tenant("Lima");
    const b = await tenant("Mike");
    await connect(a, "whatsapp", { phoneNumberId: "100000000055" });
    const admin = await makeUser();
    await grant(admin.user.id, "SUPER_ADMIN", "PLATFORM", PLATFORM_ID);
    await expectCode(adminSetOwnAccountCredentials(admin.ctx, b.org.id, "whatsapp", { companyId: b.company.id, fields: { apiKey: "EAAG" + "y".repeat(80), phoneNumberId: "100000000055" }, reason: "setup for customer" }), "conflict");
    // A company of another organization cannot be targeted through this organization.
    await expectCode(adminSetOwnAccountCredentials(admin.ctx, b.org.id, "mailchimp", { companyId: a.company.id, fields: { apiKey: MC_KEY }, reason: "wrong org" }), "not_found");
  });
});
