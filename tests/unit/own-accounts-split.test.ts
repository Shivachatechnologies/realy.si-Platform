import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  customerConnectMode,
  isOwnAccountProvider,
  isPlatformManaged,
  isSetUpByRealy,
  OWN_ACCOUNT_PROVIDERS,
  ownAccountSetupFields,
  platformCredentialFields,
  providerInfo,
} from "@/server/modules/integrations/catalog";
import { isPlatformKey, platformKeyDef } from "@/server/core/platform-secrets-catalog";
import { platformConnection } from "@/server/modules/integrations/platform-managed";
import { authHeaders, exchangeCode, oauthClient, revokeToken } from "@/server/modules/integrations/providers";
import { buildAuthorizeUrl } from "@/server/modules/integrations/oauth";
import { splitWhatsAppByPhoneNumber, verifyRazorpaySignature } from "@/server/modules/integrations/own-account-webhooks";
import { resetEnvCache } from "@/server/core/env";
import { hmacSha256 } from "@/server/core/crypto";

/**
 * The platform / customer split (docs/integrations.md §7): Stripe, Razorpay, WhatsApp and Mailchimp are the customer's
 * OWN accounts, connected through Realy's platform apps (fake provider endpoints below), while Realy's own billing keys
 * keep their separate meaning.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const CO = "00000000-0000-4000-8000-000000000002";
const USER = "00000000-0000-4000-8000-000000000003";
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

type Call = { url: string; init?: RequestInit };
function fakeFetch(routes: Record<string, (call: Call) => { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) return new Response(JSON.stringify({ error: "no fake route" }), { status: 404 });
    const r = routes[key]!({ url, init });
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  });
  return calls;
}
const formOf = (c: Call) => new URLSearchParams(String(c.init?.body ?? ""));

describe("platform / customer split", () => {
  it("moves Stripe, Razorpay, WhatsApp and Mailchimp to the customer's own accounts", () => {
    expect([...OWN_ACCOUNT_PROVIDERS].sort()).toEqual(["mailchimp", "razorpay", "stripe", "whatsapp"]);
    for (const p of OWN_ACCOUNT_PROVIDERS) {
      const info = providerInfo(p)!;
      expect(isOwnAccountProvider(p)).toBe(true);
      expect(isPlatformManaged(p)).toBe(false);
      expect(customerConnectMode(info)).toBe("oauth");
      // No platform keys are derived from their credential fields any more, and no platform connection is built.
      expect(platformCredentialFields(info)).toEqual([]);
      expect(platformConnection(ORG, CO, p)).toBeNull();
      // The Realy team can still enter the org's own credentials from the admin app.
      expect(ownAccountSetupFields(info).some((f) => f.key === "apiKey")).toBe(true);
    }
    expect(isOwnAccountProvider("openai")).toBe(false);
    expect(isSetUpByRealy({ setupBy: "realy_team" })).toBe(true);
    expect(isSetUpByRealy({ setupBy: "customer" })).toBe(false);
    expect(isSetUpByRealy(null)).toBe(false);
  });

  it("keeps Realy's billing keys and adds the platform app keys", () => {
    for (const k of ["STRIPE_API_KEY", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "WHATSAPP_API_KEY", "WHATSAPP_PHONE_NUMBER_ID", "MAILCHIMP_API_KEY", "MAILCHIMP_SERVER_PREFIX"]) expect(isPlatformKey(k), k).toBe(false);
    for (const k of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_CONNECT_CLIENT_ID", "STRIPE_CONNECT_WEBHOOK_SECRET", "RAZORPAY_CLIENT_ID", "RAZORPAY_CLIENT_SECRET", "RAZORPAY_WEBHOOK_SECRET", "WHATSAPP_APP_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_CONFIG_ID", "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "MAILCHIMP_CLIENT_ID", "MAILCHIMP_CLIENT_SECRET"]) expect(isPlatformKey(k), k).toBe(true);
    expect(platformKeyDef("STRIPE_WEBHOOK_SECRET")!.register?.paths).toEqual(["/api/v1/webhooks/stripe"]);
    expect(platformKeyDef("STRIPE_CONNECT_WEBHOOK_SECRET")!.register?.paths).toEqual(["/api/v1/webhooks/stripe-connect"]);
    expect(platformKeyDef("STRIPE_CONNECT_CLIENT_ID")!.validate("ca_" + "A".repeat(20), () => undefined)).toBeNull();
    expect(platformKeyDef("STRIPE_CONNECT_CLIENT_ID")!.validate("sk_live_xxx", () => undefined)).not.toBeNull();
    expect(platformKeyDef("WHATSAPP_APP_SECRET")!.kind).toBe("secret");
  });

  it("uses Realy's platform apps as OAuth clients only when configured", () => {
    expect(oauthClient("stripe")).toBeNull();
    setEnv("STRIPE_CONNECT_CLIENT_ID", "ca_" + "c".repeat(24));
    expect(oauthClient("stripe")).toBeNull(); // the platform secret key is needed too
    setEnv("STRIPE_SECRET_KEY", "sk_test_" + "s".repeat(24));
    expect(oauthClient("stripe")).toEqual({ clientId: "ca_" + "c".repeat(24), clientSecret: "sk_test_" + "s".repeat(24) });
    setEnv("WHATSAPP_APP_ID", "1234567890");
    setEnv("WHATSAPP_APP_SECRET", "a".repeat(32));
    expect(oauthClient("whatsapp")).toBeNull(); // Embedded Signup also needs the configuration id
    setEnv("WHATSAPP_CONFIG_ID", "998877665544");
    expect(oauthClient("whatsapp")?.clientId).toBe("1234567890");
    const url = new URL(buildAuthorizeUrl("whatsapp", { organizationId: ORG, companyId: CO, userId: USER, locale: "en-US" }).url);
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v21.0/dialog/oauth");
    expect(url.searchParams.get("config_id")).toBe("998877665544");
    expect(url.searchParams.get("client_id")).toBe("1234567890");
    const stripeUrl = new URL(buildAuthorizeUrl("stripe", { organizationId: ORG, companyId: CO, userId: USER, locale: "en-US" }).url);
    expect(stripeUrl.host).toBe("connect.stripe.com");
    expect(stripeUrl.searchParams.get("scope")).toBe("read_write");
  });

  it("authenticates Razorpay OAuth tokens as bearer, admin-set keys as Basic", () => {
    expect(authHeaders("razorpay", "tok", { authMode: "oauth" })).toEqual({ authorization: "Bearer tok" });
    expect(authHeaders("razorpay", "secret", { keyId: "rzp_test_abc" }).authorization).toMatch(/^Basic /);
  });
});

describe("Connect with X token exchange (fake provider endpoints)", () => {
  beforeEach(() => {
    setEnv("STRIPE_CONNECT_CLIENT_ID", "ca_" + "c".repeat(24));
    setEnv("STRIPE_SECRET_KEY", "sk_test_" + "s".repeat(24));
    setEnv("RAZORPAY_CLIENT_ID", "rzpclient123");
    setEnv("RAZORPAY_CLIENT_SECRET", "rzpsecret123456");
    setEnv("MAILCHIMP_CLIENT_ID", "mcclient123");
    setEnv("MAILCHIMP_CLIENT_SECRET", "mcsecret123456");
    setEnv("WHATSAPP_APP_ID", "1234567890");
    setEnv("WHATSAPP_APP_SECRET", "a".repeat(32));
    setEnv("WHATSAPP_CONFIG_ID", "998877665544");
  });

  it("Stripe Connect: stores the connected account id; deauthorizes on disconnect", async () => {
    const calls = fakeFetch({
      "https://connect.stripe.com/oauth/token": () => ({ body: { access_token: "sk_acct_token", refresh_token: "rt_1", stripe_user_id: "acct_1ABCDEF234", livemode: false, scope: "read_write" } }),
      "https://connect.stripe.com/oauth/deauthorize": () => ({ body: { stripe_user_id: "acct_1ABCDEF234" } }),
    });
    const t = await exchangeCode("stripe", "ac_code", null);
    expect(t.accessToken).toBe("sk_acct_token");
    expect(t.extra).toMatchObject({ stripeAccountId: "acct_1ABCDEF234", authMode: "connect", livemode: false });
    // Basic auth with the platform secret key as the user name.
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBe(`Basic ${Buffer.from("sk_test_" + "s".repeat(24) + ":").toString("base64")}`);
    expect(formOf(calls[0]!).get("code")).toBe("ac_code");
    expect(await revokeToken("stripe", "sk_acct_token", { stripeAccountId: "acct_1ABCDEF234" })).toBe(true);
    expect(formOf(calls[1]!).get("stripe_user_id")).toBe("acct_1ABCDEF234");
    expect(formOf(calls[1]!).get("client_id")).toBe("ca_" + "c".repeat(24));
  });

  it("Razorpay partner OAuth: stores the merchant account id and expiry", async () => {
    const calls = fakeFetch({ "https://auth.razorpay.com/token": () => ({ body: { access_token: "rzp_at", refresh_token: "rzp_rt", expires_in: 7776000, razorpay_account_id: "acc_ABCDEF123456" } }) });
    const t = await exchangeCode("razorpay", "code1", null);
    expect(t.extra).toMatchObject({ razorpayAccountId: "acc_ABCDEF123456", authMode: "oauth" });
    expect(t.refreshToken).toBe("rzp_rt");
    expect(t.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 80 * 86_400_000);
    expect(formOf(calls[0]!).get("mode")).toBe("live");
    expect(formOf(calls[0]!).get("client_secret")).toBe("rzpsecret123456");
  });

  it("Mailchimp OAuth2: token, then metadata for the data center", async () => {
    fakeFetch({
      "https://login.mailchimp.com/oauth2/token": () => ({ body: { access_token: "mc_at", expires_in: 0 } }),
      "https://login.mailchimp.com/oauth2/metadata": () => ({ body: { dc: "us21", accountname: "Acme", api_endpoint: "https://us21.api.mailchimp.com" } }),
    });
    const t = await exchangeCode("mailchimp", "c", null);
    expect(t.extra).toMatchObject({ authMode: "oauth", serverPrefix: "us21", accountName: "Acme" });
    expect(t.expiresAt).toBeNull();
  });

  it("WhatsApp Embedded Signup: finds the shared WABA and number, subscribes the app, keeps the PIN secret", async () => {
    const calls = fakeFetch({
      "https://graph.facebook.com/v21.0/oauth/access_token": () => ({ body: { access_token: "EAAbusiness", token_type: "bearer" } }),
      "https://graph.facebook.com/v21.0/debug_token": () => ({ body: { data: { granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["102030405060"] }, { scope: "business_management" }], expires_at: 0 } } }),
      "https://graph.facebook.com/v21.0/102030405060/phone_numbers": () => ({ body: { data: [{ id: "555666777888", display_phone_number: "+386 40 123 456", verified_name: "Acme" }] } }),
      "https://graph.facebook.com/v21.0/102030405060/subscribed_apps": () => ({ body: { success: true } }),
      "https://graph.facebook.com/v21.0/555666777888/register": () => ({ body: { success: true } }),
    });
    const t = await exchangeCode("whatsapp", "code", null);
    expect(t.extra).toMatchObject({ authMode: "embedded_signup", businessAccountId: "102030405060", phoneNumberId: "555666777888", activeAccountId: "555666777888" });
    expect(JSON.stringify(t.extra)).not.toContain("registrationPin");
    expect(t.secrets?.registrationPin).toMatch(/^\d{6}$/);
    expect(calls.some((c) => c.url.endsWith("/102030405060/subscribed_apps") && c.init?.method === "POST")).toBe(true);
    // The app token for debug_token is app id | app secret, never sent to the browser.
    expect(new Headers(calls.find((c) => c.url.includes("debug_token"))!.init?.headers).get("authorization")).toBe(`Bearer 1234567890|${"a".repeat(32)}`);
  });

  it("WhatsApp Embedded Signup fails honestly when no business account was shared", async () => {
    fakeFetch({
      "https://graph.facebook.com/v21.0/oauth/access_token": () => ({ body: { access_token: "EAAbusiness" } }),
      "https://graph.facebook.com/v21.0/debug_token": () => ({ body: { data: { granular_scopes: [] } } }),
    });
    await expect(exchangeCode("whatsapp", "code", null)).rejects.toThrow(/No WhatsApp Business account/);
  });
});

describe("platform webhook helpers", () => {
  it("splits a WhatsApp body by phone_number_id so each company gets only its own changes", () => {
    const change = (id: string, text: string) => ({ field: "messages", value: { metadata: { phone_number_id: id }, messages: [{ id: `wamid.${text}`, from: "38640111222", type: "text", text: { body: text } }] } });
    const body = { object: "whatsapp_business_account", entry: [{ id: "w1", changes: [change("111111", "a"), change("222222", "b")] }, { id: "w2", changes: [change("111111", "c"), { value: { metadata: {} } }] }] };
    const slices = splitWhatsAppByPhoneNumber(body);
    expect([...slices.keys()].sort()).toEqual(["111111", "222222"]);
    expect(JSON.stringify(slices.get("111111"))).toContain("wamid.a");
    expect(JSON.stringify(slices.get("111111"))).toContain("wamid.c");
    expect(JSON.stringify(slices.get("111111"))).not.toContain("wamid.b");
    expect(JSON.stringify(slices.get("222222"))).not.toContain("wamid.a");
  });

  it("verifies Razorpay partner webhook signatures", () => {
    const raw = JSON.stringify({ event: "payment.captured", account_id: "acc_ABCDEF123456" });
    const sig = hmacSha256("whsecret-razor", raw).toString("hex");
    expect(verifyRazorpaySignature("whsecret-razor", raw, sig)).toBe(true);
    expect(verifyRazorpaySignature("whsecret-razor", raw + " ", sig)).toBe(false);
    expect(verifyRazorpaySignature("whsecret-razor", raw, null)).toBe(false);
  });
});
