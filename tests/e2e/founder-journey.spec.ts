import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { currentStep, hotp } from "../../packages/backend/src/server/modules/auth/totp";
import { makePdf } from "../pdf";

const SHOTS = process.env.E2E_SCREENSHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

/** The Control Center is a separate app (apps/admin, admin.realy.si) with its own sign-in. */
const ADMIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3001";

const email = `founder-${Date.now()}@example.test`;
const password = "correct horse battery staple";

/** Expected copy for non-English pages comes from the shipped catalog. */
const arAE = JSON.parse(readFileSync("apps/user/src/i18n/messages/ar-AE.json", "utf8"));

test.describe.configure({ mode: "serial" });

test("visitors get the localized public site and can reach sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/en-US$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await page.getByRole("banner").getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en-US\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in to Realy" })).toBeVisible();
  // The app itself needs a session.
  await page.goto("/en-US/company");
  await expect(page).toHaveURL(/\/en-US\/sign-in/);
});

test("Accept-Language picks the locale for first visits", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "ar-AE", extraHTTPHeaders: { "accept-language": "ar-AE,ar;q=0.9" } });
  const page = await ctx.newPage();
  await page.goto("/pricing");
  await expect(page).toHaveURL(/\/ar-AE\/pricing$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar-AE");
  await ctx.close();
});

test("founder signs up and completes the onboarding journey for a UAE company, honestly without AI", async ({ page }) => {
  await page.goto("/en-US/sign-up");
  await page.getByLabel("Full name").fill("Priya Founder");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("Country you live in").selectOption("IN");
  await page.getByRole("button", { name: "Create account" }).click();

  // 1 · Welcome: the account that owns the companies.
  await expect(page).toHaveURL(/\/en-US\/onboarding$/);
  await expect(page.getByLabel("Where you live")).toHaveValue("IN");
  await page.getByLabel("Organization name").fill("Priya Holdings");
  await page.getByRole("button", { name: "Begin the journey" }).click();

  // 2 · Vision: a new business; suggestions follow the company's country.
  await page.getByRole("radio", { name: /New business from an idea/ }).click();
  await page.getByLabel("Your description").fill("A logistics marketplace for small exporters in the Gulf.");
  await page.getByLabel("Company name").fill("Gulf Ventures");
  await page.getByLabel("Country", { exact: true }).selectOption("AE");
  await expect(page.getByLabel("Base currency")).toHaveValue("AED");
  await shot(page, "01-onboarding-vision");
  await page.getByRole("button", { name: "Start the research" }).click();

  // 3 · Intelligence: no AI provider in this environment, and the journey says so instead of faking research.
  await expect(page).toHaveURL(/stage=intelligence/);
  await expect(page.getByText("AI research is not available")).toBeVisible();
  await page.getByRole("button", { name: "Continue without AI" }).click();

  // 4 · Blueprint: built by the founder; nothing is created until it is approved.
  await expect(page).toHaveURL(/stage=blueprint/);
  await expect(page.getByRole("button", { name: "Approve and build" })).toBeDisabled();
  await page.getByRole("button", { name: "Add product" }).click();
  await page.getByPlaceholder("Product or service").fill("Gulf App");
  await page.getByRole("button", { name: "Approve and build" }).click();
  await expect(page.getByRole("heading", { name: "Your company is built" })).toBeVisible();
  await page.getByRole("button", { name: "Hire the AI team" }).click();

  // 5 · AI team: the standard starter team, labelled as not generated for this business.
  await expect(page.getByText("AI is not available, so here is the standard starter team", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: /^Hire \d+ AI employees$/ }).click();
  await expect(page.getByRole("heading", { name: /AI employees hired$/ })).toBeVisible();
  await page.getByRole("button", { name: "Go to launch" }).click();

  // 6 · Launch → Command Center.
  await expect(page.getByRole("heading", { name: "Gulf Ventures is ready" })).toBeVisible();
  await page.getByRole("button", { name: "Enter the Command Center" }).click();
  await expect(page).toHaveURL(/\/en-US$/);
  await expect(page.getByRole("heading", { name: /Your company is live/ })).toBeVisible();
  // No fake AI: planning says plainly that no provider is configured.
  await expect(page.getByText("AI planning is unavailable: no AI provider is configured.")).toBeVisible();
  await expect(page.getByPlaceholder("Get our first 100 US customers.")).toBeVisible();
  await shot(page, "02-command-center");

  // The company carries the UAE defaults: currency, timezone and data region.
  await page.goto("/en-US/company");
  await expect(page.getByLabel("Company timezone")).toHaveValue("Asia/Dubai");
  const row = page.getByRole("row").filter({ hasText: "Gulf Ventures" });
  await expect(row).toContainText("United Arab Emirates");
  await expect(row).toContainText("AED");
  await expect(row).toContainText("Middle East (me-central)");
});

let recoveryCodes: string[] = [];

/** Sign in; once MFA is enrolled, complete it with a fresh single-use recovery code (TOTP codes can't be replayed). */
async function signIn(page: Page, base = "", landing: RegExp = /\/en-US$/) {
  await page.goto(`${base}/en-US/${base ? "login" : "sign-in"}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (recoveryCodes.length) {
    await expect(page).toHaveURL(/\/en-US\/mfa(\?.*)?$/);
    await page.getByLabel("Verification code").fill(recoveryCodes.shift()!);
    await page.getByRole("button", { name: "Verify" }).click();
  }
  await expect(page).toHaveURL(landing);
}

test("founder enrolls TOTP two-factor authentication and receives recovery codes", async ({ page }) => {
  await signIn(page);
  await page.goto("/en-US/settings/security");
  await page.getByRole("button", { name: "Set up authenticator app" }).click();
  const secret = await page.getByLabel("Setup key").inputValue();
  await page.getByLabel("6-digit code").fill(hotp(secret, currentStep()));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("heading", { name: "Recovery codes" })).toBeVisible();
  recoveryCodes = (await page.locator("ul[dir=ltr] li").allTextContents()).map((c) => c.trim());
  expect(recoveryCodes).toHaveLength(10);
  await shot(page, "03-mfa");
});

test("a wrong verification code is rejected", async ({ page }) => {
  await page.goto("/en-US/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en-US\/mfa(\?.*)?$/);
  // Pending-MFA sessions cannot reach the app.
  await page.goto("/en-US/company");
  await expect(page).toHaveURL(/\/en-US\/mfa(\?.*)?$/);
  await page.getByLabel("Verification code").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("Your email, password or code is incorrect.")).toBeVisible();
});

test("the trial plan, billing country and quotes are explicit; checkout is honestly not configured", async ({ page }) => {
  await signIn(page);
  await page.goto("/en-US/settings/billing");
  // New organizations run on the 7-day Growth trial.
  await expect(page.getByRole("heading", { name: "Growth", level: 2 })).toBeVisible();
  await expect(page.getByText("Free trial").first()).toBeVisible();
  for (const [plan, price] of [
    ["Starter", "$99.00 per month"],
    ["Growth", "$199.00 per month"],
    ["Scale", "$999.00 per month"],
  ]) {
    await expect(page.getByRole("heading", { name: plan, level: 3 })).toBeVisible();
    await expect(page.getByText(price, { exact: true })).toBeVisible();
  }

  await expect(page.getByText("Where you live: India")).toBeVisible();
  await page.getByLabel("Billing country").selectOption("AE");
  await page.getByRole("button", { name: "Confirm billing country" }).click();
  await expect(page.getByText("Confirmed billing country: United Arab Emirates")).toBeVisible();
  await page.getByLabel("Plan", { exact: true }).selectOption("starter");
  await page.getByRole("button", { name: "Get quote" }).click();
  // Plans have a GLOBAL USD list price; the UAE adds its VAT treatment.
  await expect(page.getByText("$99.00 per month")).toHaveCount(2);
  await expect(page.getByText("VAT included")).toBeVisible();
  // Stripe is not configured in this environment: the UI says so and checkout cannot start.
  await expect(page.getByText("Billing is not configured.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to payment" })).toBeDisabled();
  await shot(page, "03-billing");
});

test("Arabic switches the whole UI to RTL, and plan-locked modules say which plan unlocks them", async ({ page }) => {
  await signIn(page);
  await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("ar-AE");
  await expect(page).toHaveURL(/\/ar-AE$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("link", { name: arAE.nav.commandCenter, exact: true }).first()).toBeVisible();
  await shot(page, "04-command-center-ar");
  // Finance is a Scale feature: the trial shows an honest upgrade page instead of an empty module.
  await page.goto("/ar-AE/finance");
  await expect(page).toHaveURL(/\/ar-AE\/upgrade\?feature=feature\.finance/);
  await expect(page.getByRole("heading", { name: arAE.upgrade.pageTitle })).toBeVisible();
  // Back to English for the remaining steps (preference is stored on the profile).
  await page.goto("/ar-AE/settings");
  await page.locator("#locale").selectOption("en-US");
  await page.getByRole("button", { name: arAE.common.save, exact: true }).first().click();
  await expect(page).toHaveURL(/\/en-US\/settings$/);
});

test("founder maps the company graph: people, teams, products and typed relations", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Company Graph" }).first().click();
  await expect(page).toHaveURL(/\/en-US\/graph$/);
  await expect(page.getByRole("heading", { name: "Company Graph" })).toBeVisible();
  // The product approved in the blueprint is already on the graph.
  await expect(page.getByRole("button", { name: "Gulf App", exact: true })).toBeVisible();
  const add = async (kind: string, name: string) => {
    await page.getByLabel("Type").selectOption(kind);
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  };
  await add("PERSON", "Priya");
  await add("TEAM", "Growth");

  await page.getByRole("button", { name: "Priya", exact: true }).click();
  await page.getByLabel("Relation", { exact: true }).selectOption("MEMBER_OF");
  await expect(page.getByLabel("Connects to")).toHaveValue(/.+/);
  await page.getByRole("button", { name: "Connect" }).click();
  const relations = page.getByRole("region", { name: "Relations" });
  await expect(relations.getByText("member of")).toBeVisible();
  await expect(relations.getByText("Growth")).toBeVisible();
  await expect(page.getByText("3 entities · 1 relation")).toBeVisible();

  // Typed relations only offer valid targets: a person "works on" products, never teams.
  await page.getByLabel("Relation", { exact: true }).selectOption("WORKS_ON");
  await expect(page.getByLabel("Connects to").locator("option")).toHaveText(["Gulf App · Product"]);
  await page.reload();
  await expect(page.getByText("3 entities · 1 relation")).toBeVisible();
  await shot(page, "05-company-graph");
});

test("founder adds documents to Company Brain and finds cited passages", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Company Brain" }).first().click();
  await expect(page).toHaveURL(/\/en-US\/brain$/);
  await expect(page.getByText("No documents yet.", { exact: false }).first()).toBeVisible();

  // Upload a Markdown file…
  await page.getByLabel("File").setInputFiles({
    name: "refund-policy.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Refund policy\n\nCustomers may request a full refund within 30 days of purchase."),
  });
  await page.getByRole("button", { name: "Add and index" }).click();
  await expect(page).toHaveURL(/\/en-US\/brain\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("region", { name: "Passage 1" })).toContainText("full refund within 30 days");

  // …and paste a note.
  await page.goto("/en-US/brain");
  await page.getByLabel("Title").fill("Launch plan");
  await page.getByLabel("Or paste text").fill("We launch in the United Arab Emirates first, then India.");
  await page.getByRole("button", { name: "Add and index" }).click();
  await expect(page.getByRole("heading", { name: "Launch plan" })).toBeVisible();

  await page.goto("/en-US/brain");
  await expect(page.getByText("2 documents")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search Company Brain" }).fill("refunds");
  await page.getByRole("searchbox", { name: "Search Company Brain" }).press("Enter");
  const results = page.getByRole("region", { name: "Search results" });
  await expect(results.getByText("1 passage matches “refunds”.")).toBeVisible();
  await expect(results.locator("mark").first()).toHaveText(/refund/i);
  await shot(page, "06-company-brain-search");

  await results.getByRole("link", { name: "refund-policy · Passage 1" }).click();
  await expect(page).toHaveURL(/\/brain\/[0-9a-f-]{36}#passage-1$/);
  await expect(page.getByRole("region", { name: "Passage 1" })).toBeVisible();

  // Unsupported files are refused with a clear error and nothing is stored.
  await page.goto("/en-US/brain");
  await page.getByLabel("File").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: Buffer.from("PNG") });
  await page.getByRole("button", { name: "Add and index" }).click();
  await expect(page.getByText("This file type isn't supported yet.", { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByText("2 documents")).toBeVisible();
});

test("AI Workforce shows the hired team; AI Tasks says plainly when no AI provider is configured", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "AI Workforce" }).first().click();
  await expect(page).toHaveURL(/\/en-US\/workforce$/);
  await expect(page.getByRole("heading", { name: "AI Workforce", level: 1 })).toBeVisible();
  await expect(page.getByText("AI Research Analyst").first()).toBeVisible();
  await expect(page.getByText("AI CEO").first()).toBeVisible();

  await page.goto("/en-US/tasks");
  // This E2E environment has no ANTHROPIC_API_KEY: no fake execution, an explicit notice instead.
  await expect(page.getByText("AI execution isn't configured in this environment.", { exact: false })).toBeVisible();

  await page.goto("/en-US");
  await expect(page.getByRole("link", { name: /^\d+ AI employees$/ })).toBeVisible();
  await shot(page, "07-ai-tasks-not-configured");
});

test("Products, Customers and Documents are working pages; Scale modules are honestly locked on the trial", async ({ page }) => {
  await signIn(page);
  await page.goto("/en-US/products");
  await expect(page.getByText("Gulf App").first()).toBeVisible(); // from the approved blueprint

  await page.goto("/en-US/customers");
  await page.getByLabel("Name", { exact: true }).fill("Dubai Retail Group");
  await page.getByRole("button", { name: "Add account" }).click();
  // The new account opens; it is listed among the customers.
  await expect(page.getByRole("heading", { name: "Dubai Retail Group", level: 1 })).toBeVisible();
  await page.goto("/en-US/customers");
  await expect(page.getByText("1 account", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dubai Retail Group" }).first()).toBeVisible();

  // People (HR) and Projects are Scale features: an upgrade page names the plan instead of an empty module.
  for (const [path, feature] of [
    ["/en-US/people", "feature.hr"],
    ["/en-US/projects", "feature.projects_operations"],
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/en-US/upgrade\\?feature=${feature.replace(".", "\\.")}`));
    await expect(page.getByText("This is included in Scale and above.")).toBeVisible();
  }

  // PDF upload through the browser: the text layer is indexed and searchable.
  await page.goto("/en-US/brain");
  await page.getByLabel("File").setInputFiles({ name: "security-policy.pdf", mimeType: "application/pdf", buffer: makePdf([["Security policy", "All laptops use full-disk encryption."]]) });
  await page.getByRole("button", { name: "Add and index" }).click();
  await expect(page).toHaveURL(/\/en-US\/brain\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("region", { name: "Passage 1" })).toContainText("full-disk encryption");
  await expect(page.getByText("application/pdf")).toBeVisible();
  await page.goto("/en-US/documents");
  await expect(page.getByText("3 documents")).toBeVisible();
});

test("mobile layout keeps navigation reachable", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await signIn(page);
  // Phones get a bottom tab bar; "More" opens the full navigation drawer.
  // Until it is dismissed, the cookie notice sits over the tab bar.
  await page.getByRole("region", { name: "Cookie notice" }).getByRole("button", { name: "OK" }).click();
  const tabs = page.getByRole("navigation", { name: "Main sections" });
  await expect(tabs.getByRole("link", { name: "Command" })).toBeVisible();
  await tabs.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("button", { name: "Close navigation" })).toBeVisible();
  await page.getByRole("navigation", { name: "Command Center" }).getByRole("link", { name: "Overview" }).click();
  await expect(page).toHaveURL(/\/en-US\/company$/);
  await expect(page.getByRole("cell", { name: "Gulf Ventures" })).toBeVisible();
  // Wide tables scroll inside their card; the page itself never scrolls horizontally.
  for (const path of ["/en-US/company", "/en-US", "/en-US/settings/billing"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  await page.goto("/en-US/company");
  await shot(page, "06-mobile-companies");
  await ctx.close();
});

test("platform admin changes the Growth EU price in the Control Center; history and audit are preserved", async ({ page }) => {
  try {
    execFileSync("pnpm", ["-s", "realy:grant-role", email, "SUPER_ADMIN"], { stdio: "pipe", env: process.env });
  } catch (e) {
    // On a fresh database the founder is the first account and already SUPER_ADMIN (first-run bootstrap, docs/rbac.md).
    if (!/Role already assigned/.test(String((e as { stderr?: Buffer }).stderr ?? e))) throw e;
  }
  await signIn(page, ADMIN, /\/en-US$/); // MFA-verified session: required for pricing.manage

  await page.goto(`${ADMIN}/en-US/pricing`);
  await expect(page.getByRole("heading", { name: "Market prices" })).toBeVisible();
  await page.getByRole("button", { name: "Growth growth Active" }).click();
  const eu = page.getByRole("row", { name: /^Region EU EU Monthly / });
  // Seeded at €199.00 v1 (entitlements/catalog.ts); read it so a re-run against the same database still works.
  await expect(eu).toContainText(/€\d/);
  const before = (await eu.textContent())!.match(/€([\d,]+)\.00v(\d+)/)!;
  const next = Number(before[1]!.replace(/,/g, "")) + 10;
  const reason = `EU price review ${email} (e2e)`;
  await eu.getByRole("button", { name: "Change price" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/New amount/).fill(String(next));
  await expect(dialog.getByText(`€${next}.00`)).toBeVisible();
  await dialog.getByLabel("Reason").fill(reason);
  await dialog.getByRole("button", { name: "Change price" }).click();
  await expect(dialog).toBeHidden();
  await expect(eu).toContainText(`€${next}.00`);
  await expect(eu).toContainText(`v${Number(before[2]) + 1}`);
  // The GLOBAL USD price is untouched.
  await expect(page.getByRole("row", { name: /^Global Global Monthly / })).toContainText("$199.00");
  await shot(page, "05-pricing-console");

  // User directory: the founder is listed with their platform role; a super admin can't suspend themselves.
  await page.goto(`${ADMIN}/en-US/users`);
  await page.getByRole("searchbox", { name: "Search by email or name" }).fill(email);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const me = page.getByRole("listitem").filter({ hasText: email });
  await expect(me).toContainText("SUPER_ADMIN");
  await me.getByRole("link", { name: "Priya Founder" }).click();
  await expect(page.getByRole("heading", { name: "Priya Founder" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Suspend" })).toHaveCount(0);
  await page.goto(`${ADMIN}/en-US/organizations`);
  await expect(page.getByText("Priya Holdings").first()).toBeVisible();

  await page.goto(`${ADMIN}/en-US/audit?category=ADMIN`);
  await expect(page.getByRole("cell", { name: "pricing.price_version.created" }).first()).toBeVisible();
  await expect(page.getByText(reason)).toBeVisible();

  // The public pricing page shows the new EU price.
  await page.goto("/en-US/pricing");
  await page.getByLabel("Billing country").selectOption("DE");
  await expect(page.getByText(`€${next}.00`).first()).toBeVisible();
});
