import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";
import { displayName, formatMoney } from "../../src/i18n/format";
import { currentStep, hotp } from "../../src/server/modules/auth/totp";

/**
 * Global SaaS regression (Phase 1.1 §14/§15): four founders in four markets, each in their own
 * language, currency, timezone and text direction; tenant isolation between them; honest
 * "not configured" states; and no horizontal page overflow from phone to desktop.
 */
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "correct horse battery staple";
const RUN = Date.now();

interface Persona {
  key: string;
  locale: string;
  dir: "ltr" | "rtl";
  country: string;
  currency: string;
  timezone: string;
  targetMarkets: string[];
}

const PERSONAS: Persona[] = [
  { key: "india", locale: "hi-IN", dir: "ltr", country: "IN", currency: "INR", timezone: "Asia/Kolkata", targetMarkets: ["IN"] },
  { key: "uae", locale: "ar-AE", dir: "rtl", country: "AE", currency: "AED", timezone: "Asia/Dubai", targetMarkets: ["AE", "SA"] },
  { key: "usa", locale: "en-US", dir: "ltr", country: "US", currency: "USD", timezone: "America/New_York", targetMarkets: ["US", "CA"] },
  { key: "germany", locale: "de-DE", dir: "ltr", country: "DE", currency: "EUR", timezone: "Europe/Berlin", targetMarkets: ["DE", "FR"] },
];

type Messages = Record<string, unknown>;
const catalogs = new Map<string, Messages>();
/** Expected UI copy comes from the shipped catalogs, so the test checks the real translation is rendered. */
function msg(locale: string, key: string): string {
  if (!catalogs.has(locale)) catalogs.set(locale, JSON.parse(readFileSync(`src/i18n/messages/${locale}.json`, "utf8")));
  const v = key.split(".").reduce<unknown>((o, k) => (o as Messages | undefined)?.[k], catalogs.get(locale));
  if (typeof v !== "string") throw new Error(`missing message ${locale}:${key}`);
  return v;
}

interface Account {
  persona: Persona;
  email: string;
  orgId: string;
  companyId: string;
  companyName: string;
  state: Awaited<ReturnType<BrowserContext["storageState"]>>;
}
const accounts = new Map<string, Account>();

async function api(request: APIRequestContext, method: "GET" | "POST" | "PUT", path: string, data?: unknown) {
  const res = await request.fetch(`${BASE}${path}`, {
    method,
    data,
    headers: { origin: BASE, ...(method === "POST" ? { "idempotency-key": `e2e-${RUN}-${Math.random()}` } : {}) },
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

async function personaContext(browser: Browser, p: Persona, extra: Parameters<Browser["newContext"]>[0] = {}) {
  return browser.newContext({ locale: p.locale, timezoneId: p.timezone, extraHTTPHeaders: { "accept-language": p.locale }, ...extra });
}

test.describe.configure({ mode: "serial" });

for (const p of PERSONAS) {
  test(`${p.key}: ${p.locale} founder — locale, direction, currency, billing country, timezone, target markets`, async ({ browser }) => {
    const ctx = await personaContext(browser, p);
    const page = await ctx.newPage();

    // First visit negotiates the persona's language and direction.
    await page.goto("/");
    await expect(page).toHaveURL(new RegExp(`/${p.locale}/sign-in$`));
    await expect(page.locator("html")).toHaveAttribute("lang", p.locale);
    await expect(page.locator("html")).toHaveAttribute("dir", p.dir);

    const email = `${p.key}-${RUN}@example.test`;
    const signUp = await api(ctx.request, "POST", "/api/v1/auth/sign-up", { email, password: PASSWORD, name: `${p.key} founder`, locale: p.locale, timezone: p.timezone, countryCode: p.country });
    expect(signUp.status, JSON.stringify(signUp.body)).toBe(200);
    // Email delivery is not configured here; the API says so rather than claiming it was sent.
    expect(signUp.body.emailVerification).toBe("NOT_CONFIGURED");

    // Billing changes require a recent second factor: enroll TOTP through the real API.
    const setup = await api(ctx.request, "POST", "/api/v1/auth/mfa/totp/setup");
    expect(setup.status, JSON.stringify(setup.body)).toBe(200);
    const confirm = await api(ctx.request, "POST", "/api/v1/auth/mfa/totp/confirm", { code: hotp(setup.body.secret, currentStep()) });
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);

    const org = await api(ctx.request, "POST", "/api/v1/organizations", { name: `${p.key} holdings ${RUN}` });
    expect(org.status, JSON.stringify(org.body)).toBe(200);
    const companyName = `${p.key} ventures ${RUN}`;
    const company = await api(ctx.request, "POST", `/api/v1/organizations/${org.body.id}/companies`, {
      name: companyName,
      incorporationCountryCode: p.country,
      operatingCountryCodes: [p.country],
      targetMarketCodes: p.targetMarkets,
    });
    expect(company.status, JSON.stringify(company.body)).toBe(200);
    // Currency and timezone default from the incorporation country.
    expect(company.body.baseCurrency).toBe(p.currency);
    expect(company.body.timezone).toBe(p.timezone);
    expect(company.body.targetMarketCodes).toEqual(p.targetMarkets);

    // Billing country is only ever what the user confirmed.
    const unconfirmed = await api(ctx.request, "POST", `/api/v1/organizations/${org.body.id}/checkout/quote`, { planKey: "founder", interval: "MONTH" });
    expect(unconfirmed.status).toBeGreaterThanOrEqual(400);
    const profile = await api(ctx.request, "PUT", `/api/v1/organizations/${org.body.id}/billing-profile`, { billingCountryCode: p.country, confirmCountry: true });
    expect(profile.status, JSON.stringify(profile.body)).toBe(200);
    const quote = await api(ctx.request, "POST", `/api/v1/organizations/${org.body.id}/checkout/quote`, { planKey: "founder", interval: "MONTH" });
    expect(quote.status, JSON.stringify(quote.body)).toBe(200);
    expect(quote.body.billingCountryCode).toBe(p.country);
    expect(quote.body.total.currency).toBe(p.currency);

    // Command Center renders in the persona's language with the company's country and timezone.
    await page.goto(`/${p.locale}`);
    await expect(page.locator("html")).toHaveAttribute("dir", p.dir);
    await expect(page.getByRole("heading", { name: msg(p.locale, "nav.commandCenter") }).first()).toBeVisible();
    await expect(page.getByText(displayName(p.country, "region", p.locale), { exact: true }).first()).toBeVisible();
    await expect(page.getByText(p.timezone).first()).toBeVisible();

    // Public pricing: the persona's market price, formatted for the persona's locale.
    const pricing = await api(ctx.request, "GET", `/api/v1/catalog/pricing?country=${p.country}&interval=MONTH`);
    const founder = pricing.body.plans.find((x: { key: string }) => x.key === "founder");
    expect(founder.resolution.price.money.currency).toBe(p.currency);
    await page.goto(`/${p.locale}/pricing`);
    await page.getByLabel(msg(p.locale, "pricing.country")).selectOption(p.country);
    await expect(page.getByText(formatMoney(founder.resolution.price.money, p.locale), { exact: true }).first()).toBeVisible();

    // Billing settings: confirmed country, and Stripe honestly not configured.
    await page.goto(`/${p.locale}/settings/billing`);
    await expect(page.getByText(msg(p.locale, "settings.billing.notConfigured")).first()).toBeVisible();

    // Not a platform admin: no admin data, and the admin API refuses.
    await page.goto(`/${p.locale}/admin`);
    await expect(page.getByText(msg(p.locale, "admin.noAccess"))).toBeVisible();
    const admin = await api(ctx.request, "GET", "/api/v1/admin/feature-flags");
    expect(admin.status).toBe(403);

    accounts.set(p.key, { persona: p, email, orgId: org.body.id, companyId: company.body.id, companyName, state: await ctx.storageState() });
    await ctx.close();

    // OAuth providers without credentials are shown as not configured, never as working buttons.
    const anon = await personaContext(browser, p);
    const anonPage = await anon.newPage();
    await anonPage.goto(`/${p.locale}/sign-in`);
    await expect(anonPage.getByText(msg(p.locale, "auth.oauthNotConfigured")).first()).toBeVisible();
    expect(await anonPage.locator('a[href*="/api/v1/auth/oauth/"]').count()).toBe(0);
    await anon.close();
  });
}

test("tenant isolation: no persona can read or write another persona's organization", async ({ browser }) => {
  const list = [...accounts.values()];
  expect(list).toHaveLength(PERSONAS.length);
  for (const me of list) {
    const ctx = await browser.newContext({ storageState: me.state });
    const mine = await api(ctx.request, "GET", "/api/v1/me");
    expect(mine.body.organizations.map((o: { id: string }) => o.id)).toEqual([me.orgId]);
    for (const other of list.filter((o) => o !== me)) {
      const read = await api(ctx.request, "GET", `/api/v1/organizations/${other.orgId}/companies`);
      expect(read.status, `${me.persona.key} → ${other.persona.key}`).toBe(404);
      expect(JSON.stringify(read.body)).not.toContain(other.companyName);
      const write = await api(ctx.request, "POST", `/api/v1/organizations/${other.orgId}/companies/${other.companyId}/workspaces`, { name: "intrusion" });
      expect(write.status).toBe(404);
      const billing = await api(ctx.request, "PUT", `/api/v1/organizations/${other.orgId}/billing-profile`, { billingCountryCode: "US", confirmCountry: true });
      expect(billing.status).toBe(404);
      // Pages also refuse: another tenant's company never renders.
      const page = await ctx.newPage();
      await page.goto(`/${me.persona.locale}/company`);
      await expect(page.getByText(other.companyName)).toHaveCount(0);
      await page.close();
    }
    await ctx.close();
  }
});

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

async function assertNoHorizontalOverflow(page: Page, path: string, width: number) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${path} @ ${width}px overflows by ${overflow}px`).toBeLessThanOrEqual(0);
}

let adminGranted = false;

for (const vp of VIEWPORTS) {
  test(`no horizontal overflow at ${vp.width}px (LTR and Arabic RTL, app, admin, pricing, forms, tables)`, async ({ browser }) => {
    const usa = accounts.get("usa")!;
    // Platform admin view for the admin pages (read-only here; no changes are made).
    if (!adminGranted) {
      execFileSync("pnpm", ["-s", "realy:grant-role", usa.email, "SUPER_ADMIN"], { stdio: "pipe", env: process.env });
      adminGranted = true;
    }

    const anon = await browser.newContext({ viewport: vp });
    const anonPage = await anon.newPage();
    for (const locale of ["en-US", "ar-AE"]) {
      for (const path of ["/sign-in", "/sign-up", "/forgot-password", "/pricing"]) await assertNoHorizontalOverflow(anonPage, `/${locale}${path}`, vp.width);
    }
    await anon.close();

    const ctx = await browser.newContext({ viewport: vp, storageState: usa.state });
    const page = await ctx.newPage();
    for (const locale of ["en-US", "ar-AE"]) {
      for (const path of ["", "/company", "/settings", "/settings/members", "/settings/billing", "/settings/security", "/admin/pricing", "/admin/countries", "/admin/flags", "/admin/audit", "/admin/system"]) {
        await assertNoHorizontalOverflow(page, `/${locale}${path}`, vp.width);
      }
    }
    await ctx.close();
  });
}

test("security headers: nonce CSP on pages, deny-all CSP on API responses", async ({ request }) => {
  const page = await request.get(`${BASE}/en-US/sign-in`);
  const csp = page.headers()["content-security-policy"] ?? "";
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1];
  expect(nonce, csp).toBeTruthy();
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  // Every script tag Next.js rendered carries this request's nonce.
  const html = await page.text();
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  expect(scripts.length).toBeGreaterThan(0);
  for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`);
  // A second request gets a different nonce.
  const again = (await request.get(`${BASE}/en-US/sign-in`)).headers()["content-security-policy"];
  expect(again).not.toContain(nonce!);
  expect(page.headers()["x-frame-options"]).toBe("DENY");
  expect(page.headers()["x-content-type-options"]).toBe("nosniff");
  expect(page.headers()["x-powered-by"]).toBeUndefined();

  const apiRes = await request.get(`${BASE}/api/health`);
  expect(apiRes.headers()["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
});
