import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { execFileSync } from "node:child_process";
import { currentStep, hotp } from "../../src/server/modules/auth/totp";

const SHOTS = process.env.E2E_SCREENSHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

const email = `founder-${Date.now()}@example.test`;
const password = "correct horse battery staple";

test.describe.configure({ mode: "serial" });

test("unauthenticated visitors are routed to a localized sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/en-US\/sign-in$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { name: "Sign in to Realy" })).toBeVisible();
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

test("founder signs up, sets up a UAE company selling to the US, and lands in the Command Center", async ({ page }) => {
  await page.goto("/en-US/sign-up");
  await page.getByLabel("Full name").fill("Priya Founder");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("Country you live in").selectOption("IN");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/en-US\/onboarding$/);
  await page.getByLabel("Organization name").fill("Priya Holdings");
  await page.getByLabel("Company name").fill("Gulf Ventures");
  await page.getByLabel("Incorporation country").selectOption("AE");
  // Suggestions follow the incorporation country…
  await expect(page.getByLabel("Base currency")).toHaveValue("AED");
  await expect(page.getByLabel("Company timezone")).toHaveValue("Asia/Dubai");
  await expect(page.getByLabel("Data region")).toHaveValue("ME_CENTRAL");
  await page.getByRole("button", { name: "United States", exact: true }).click();
  await shot(page, "01-onboarding");
  await page.getByRole("button", { name: "Create company" }).click();

  await expect(page).toHaveURL(/\/en-US$/);
  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
  const profile = page.locator("section", { has: page.getByRole("heading", { name: "Company profile" }) });
  await expect(profile.getByText("United Arab Emirates", { exact: true }).first()).toBeVisible();
  await expect(profile.getByText("Middle East (me-central)")).toBeVisible();
  await expect(profile.getByText("Asia/Dubai")).toBeVisible();
  // No fake metrics: business metrics are explicitly not connected.
  await expect(page.getByText("Not connected").first()).toBeVisible();
  await expect(page.getByPlaceholder("Get our first 100 US customers.")).toBeDisabled();
  // Real activity from the audit log.
  await expect(page.getByText("company.created")).toBeVisible();
  await shot(page, "02-command-center");
});

let recoveryCodes: string[] = [];

/** Sign in; once MFA is enrolled, complete it with a fresh single-use recovery code (TOTP codes can't be replayed). */
async function signIn(page: Page) {
  await page.goto("/en-US/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (recoveryCodes.length) {
    await expect(page).toHaveURL(/\/en-US\/mfa(\?.*)?$/);
    await page.getByLabel("Verification code").fill(recoveryCodes.shift()!);
    await page.getByRole("button", { name: "Verify" }).click();
  }
  await expect(page).toHaveURL(/\/en-US$/);
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

test("billing country is confirmed explicitly and quotes resolve in that market's currency", async ({ page }) => {
  await signIn(page);
  await page.goto("/en-US/settings/billing");
  await expect(page.getByText("Where you live: India")).toBeVisible();
  await page.getByLabel("Billing country").selectOption("AE");
  await page.getByRole("button", { name: "Confirm billing country" }).click();
  await expect(page.getByText("Confirmed billing country: United Arab Emirates")).toBeVisible();
  await page.getByRole("button", { name: "Get quote" }).click();
  await expect(page.getByText(/AED\s?399\.00\s+per month/)).toBeVisible();
  await expect(page.getByText("VAT included")).toBeVisible();
  // Stripe is not configured in this environment: the UI says so and checkout cannot start.
  await expect(page.getByText("Billing is not configured.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to payment" })).toBeDisabled();
  await shot(page, "03-billing");
});

test("Arabic switches the whole UI to RTL, and unbuilt modules are honest about their phase", async ({ page }) => {
  await signIn(page);
  await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("ar-AE");
  await expect(page).toHaveURL(/\/ar-AE$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "مركز القيادة" })).toBeVisible();
  await shot(page, "04-command-center-ar");
  await page.goto("/ar-AE/objectives");
  await expect(page.getByText("تصدر هذه الوحدة في المرحلة 3")).toBeVisible();
  // Back to English for the remaining steps (preference is stored on the profile).
  await page.goto("/ar-AE/settings");
  await page.locator("#locale").selectOption("en-US");
  await page.getByRole("button", { name: "حفظ" }).click();
  await expect(page).toHaveURL(/\/en-US\/settings$/);
});

test("founder maps the company graph: people, teams, products and typed relations", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Company Graph" }).first().click();
  await expect(page).toHaveURL(/\/en-US\/graph$/);
  await expect(page.getByRole("heading", { name: "Company Graph" })).toBeVisible();
  const add = async (kind: string, name: string) => {
    await page.getByLabel("Type").selectOption(kind);
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  };
  await add("PERSON", "Priya");
  await add("TEAM", "Growth");
  await add("PRODUCT", "Gulf App");

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
  await expect(page.getByText("No documents yet.")).toBeVisible();

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
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const results = page.getByRole("region", { name: "Search results" });
  await expect(results.getByText("1 passage matches “refunds”.")).toBeVisible();
  await expect(results.locator("mark").first()).toHaveText(/refund/i);
  await shot(page, "06-company-brain-search");

  await results.getByRole("link", { name: "refund-policy · Passage 1" }).click();
  await expect(page).toHaveURL(/\/brain\/[0-9a-f-]{36}#passage-1$/);
  await expect(page.getByRole("region", { name: "Passage 1" })).toBeVisible();

  // Unsupported files are refused with a clear error and nothing is stored.
  await page.goto("/en-US/brain");
  await page.getByLabel("File").setInputFiles({ name: "deck.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") });
  await page.getByRole("button", { name: "Add and index" }).click();
  await expect(page.getByText("This file type isn't supported yet. Upload a .txt or .md file, or paste the text.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("2 documents")).toBeVisible();
});

test("mobile layout keeps navigation reachable", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await signIn(page);
  await expect(page.getByRole("button", { name: "Toggle navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("link", { name: "Overview" }).last().click();
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

test("platform admin changes the India Founder price; history and audit are preserved", async ({ page }) => {
  execFileSync("pnpm", ["-s", "realy:grant-role", email, "SUPER_ADMIN"], { stdio: "pipe", env: process.env });
  await signIn(page); // MFA-verified session: required for pricing.manage

  await page.goto("/en-US/admin/pricing");
  await expect(page.getByRole("heading", { name: "Market prices" })).toBeVisible();
  await page.getByRole("button", { name: /Founder/ }).click();
  const india = page.getByRole("row").filter({ hasText: "India" }).filter({ hasText: "Monthly" });
  await expect(india).toContainText("₹4,999.00");
  await india.getByRole("button", { name: "Change price" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/New amount/).fill("5,499");
  await expect(dialog.getByText("₹5,499.00")).toBeVisible();
  await dialog.getByLabel("Reason").fill("2026 India price review (e2e)");
  await dialog.getByRole("button", { name: "Change price" }).click();
  await expect(dialog).toBeHidden();
  await expect(india).toContainText("₹5,499.00");
  await expect(india).toContainText("v2");
  // US is untouched.
  await expect(page.getByRole("row").filter({ hasText: "United States" }).filter({ hasText: "Monthly" })).toContainText("$99.00");
  await shot(page, "05-pricing-console");

  await page.goto("/en-US/admin/audit?category=ADMIN");
  await expect(page.getByRole("cell", { name: "pricing.price_version.created" }).first()).toBeVisible();
  await expect(page.getByText("2026 India price review (e2e)")).toBeVisible();

  // The public pricing page shows the new India price.
  await page.goto("/en-US/pricing");
  await page.getByLabel("Billing country").selectOption("IN");
  await expect(page.getByText("₹5,499.00")).toBeVisible();
});
