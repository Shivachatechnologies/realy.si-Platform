import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { resetEnvCache } from "@/server/core/env";
import { buildAuthorizeUrl, readIntegrationState } from "@/server/modules/integrations/oauth";
import { authHeaders, exchangeCode, oauthClient, oauthConnectParams, verifyShopifyCallback } from "@/server/modules/integrations/providers";
import { customerConnectMode, providerInfo } from "@/server/modules/integrations/catalog";

// B33: OAuth for Calendly, Zendesk, Intercom, Shopify (+ Notion, Webflow, ClickUp). Provider endpoints are stubbed.

const KEYS = ["CALENDLY", "ZENDESK", "INTERCOM", "SHOPIFY", "NOTION", "WEBFLOW", "CLICKUP"];
const ctx = { organizationId: "00000000-0000-7000-8000-000000000001", companyId: "00000000-0000-7000-8000-000000000002", userId: "00000000-0000-7000-8000-000000000003", locale: "en-US" };

beforeAll(() => {
  for (const k of KEYS) {
    process.env[`${k}_CLIENT_ID`] = `${k.toLowerCase()}-client`;
    process.env[`${k}_CLIENT_SECRET`] = `${k.toLowerCase()}-secret`;
  }
  resetEnvCache();
});
afterAll(() => {
  for (const k of KEYS) {
    delete process.env[`${k}_CLIENT_ID`];
    delete process.env[`${k}_CLIENT_SECRET`];
  }
  resetEnvCache();
});
afterEach(() => vi.unstubAllGlobals());

describe("connect mode and platform keys", () => {
  it.each(["calendly", "zendesk", "intercom", "shopify", "notion", "webflow", "clickup"])("%s is connectable with OAuth on Realy's app", (p) => {
    expect(customerConnectMode(providerInfo(p)!)).toBe("oauth");
    expect(oauthClient(p)).toEqual({ clientId: `${p}-client`, clientSecret: `${p}-secret` });
    expect(providerInfo(p)!.envVars).toEqual([`${p.toUpperCase()}_CLIENT_ID`, `${p.toUpperCase()}_CLIENT_SECRET`]);
  });
  it("pipedrive stays unavailable (no OAuth adapter yet)", () => expect(customerConnectMode(providerInfo("pipedrive")!)).toBe("unavailable"));
});

describe("authorize URLs", () => {
  it("Calendly uses PKCE and omits an empty scope", () => {
    const u = new URL(buildAuthorizeUrl("calendly", ctx).url);
    expect(u.origin + u.pathname).toBe("https://auth.calendly.com/oauth/authorize");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.has("scope")).toBe(false);
    expect(u.searchParams.get("redirect_uri")).toMatch(/\/api\/v1\/integrations\/oauth\/calendly\/callback$/);
  });

  it("Zendesk needs the subdomain, which goes into the signed state", () => {
    expect(() => buildAuthorizeUrl("zendesk", ctx)).toThrow(); // no subdomain, no endpoint
    const r = buildAuthorizeUrl("zendesk", { ...ctx, params: oauthConnectParams("zendesk", { subdomain: "Acme" }) });
    const u = new URL(r.url);
    expect(u.host).toBe("acme.zendesk.com");
    expect(u.pathname).toBe("/oauth/authorizations/new");
    expect(u.searchParams.get("scope")).toBe("read write");
    const state = readIntegrationState(r.cookie, "zendesk", u.searchParams.get("state"));
    expect(state.params).toEqual({ subdomain: "acme" });
  });

  it("Shopify accepts a shop name or domain and refuses anything else", () => {
    expect(oauthConnectParams("shopify", { shopDomain: "acme" })).toEqual({ shopDomain: "acme.myshopify.com" });
    for (const bad of ["evil.com", "acme.myshopify.com.evil.com", "", "../x"]) expect(() => oauthConnectParams("shopify", { shopDomain: bad })).toThrow();
    const u = new URL(buildAuthorizeUrl("shopify", { ...ctx, params: { shopDomain: "acme.myshopify.com" } }).url);
    expect(u.host).toBe("acme.myshopify.com");
    expect(u.pathname).toBe("/admin/oauth/authorize");
    expect(u.searchParams.get("scope")).toContain("read_products,write_products");
  });

  it("Intercom, Notion, Webflow and ClickUp use their fixed endpoints", () => {
    expect(new URL(buildAuthorizeUrl("intercom", ctx).url).origin).toBe("https://app.intercom.com");
    expect(new URL(buildAuthorizeUrl("notion", ctx).url).searchParams.get("owner")).toBe("user");
    expect(new URL(buildAuthorizeUrl("webflow", ctx).url).host).toBe("webflow.com");
    expect(new URL(buildAuthorizeUrl("clickup", ctx).url).host).toBe("app.clickup.com");
  });
});

describe("code exchange", () => {
  it("Shopify exchanges at the shop's token endpoint; the token authenticates with the Shopify header", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ access_token: "shpua_x", scope: "read_products,write_products" }), { status: 200 });
    });
    const t = await exchangeCode("shopify", "code1", null, { shopDomain: "acme.myshopify.com" });
    expect(calls).toEqual(["https://acme.myshopify.com/admin/oauth/access_token"]);
    expect(t).toMatchObject({ accessToken: "shpua_x", scopes: ["read_products", "write_products"], extra: { authMode: "oauth" } });
    expect(authHeaders("shopify", t.accessToken, { ...t.extra })).toEqual({ "x-shopify-access-token": "shpua_x" });
  });

  it("Intercom's token field is accepted; Zendesk OAuth tokens are bearer tokens", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ token: "dG9r_intercom", token_type: "Bearer" }), { status: 200 }));
    expect((await exchangeCode("intercom", "c", null)).accessToken).toBe("dG9r_intercom");
    expect(authHeaders("zendesk", "tok", { authMode: "oauth", subdomain: "acme" })).toEqual({ authorization: "Bearer tok" });
    expect(authHeaders("zendesk", "tok", { email: "a@b.co" }).authorization).toMatch(/^Basic /); // API token setup unchanged
  });
});

describe("Shopify callback signature", () => {
  const sign = (q: URLSearchParams) => {
    const msg = [...q.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
    q.set("hmac", createHmac("sha256", "shopify-secret").update(msg).digest("hex"));
    return q;
  };
  it("accepts a correctly signed callback for the expected shop only", () => {
    const q = sign(new URLSearchParams({ code: "c", shop: "acme.myshopify.com", state: "s", timestamp: "1700000000" }));
    expect(verifyShopifyCallback(q, "shopify-secret", "acme.myshopify.com")).toBe(true);
    expect(verifyShopifyCallback(q, "shopify-secret", "other.myshopify.com")).toBe(false);
    q.set("code", "tampered");
    expect(verifyShopifyCallback(q, "shopify-secret", "acme.myshopify.com")).toBe(false);
  });
});
