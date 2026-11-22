import { describe, expect, it } from "vitest";
import { detectSecret, detectSecretIn, SECRET_REFUSAL } from "@/server/core/secret-detect";
import { requestTool, ToolDenied } from "@/server/modules/tools/gateway";
import { getTool, loadTools } from "@/server/modules/tools/registry";
import { systemContext } from "@/server/core/context";

/** The Realy AI never accepts, requests or stores keys or tokens in chat (docs/integrations.md §7). */

const ORG = "00000000-0000-4000-8000-000000000001";
const CO = "00000000-0000-4000-8000-000000000002";
const run = { ctx: systemContext(), organizationId: ORG, companyId: CO, allowedTools: ["guide_account_connection", "read_integrations"], profileKey: "integrations_engineer", taskId: null };

const SECRETS = [
  "sk_live_" + "a1B2c3D4e5F6g7H8i9J0",
  "rk_test_" + "Z".repeat(24),
  "whsec_" + "abcDEF123456789",
  "rzp_live_" + "ABCdef123456",
  "EAAG" + "x".repeat(80),
  "0123456789abcdef".repeat(2) + "-us21",
  "sk-ant-api03-" + "q".repeat(40),
  "xoxb-12345678901-abcdefghij",
  "AKIAABCDEFGHIJKLMNOP",
  "-----BEGIN PRIVATE KEY-----\nMIIE...",
];

describe("secret detection", () => {
  it("recognizes provider keys and tokens, even inside a sentence", () => {
    for (const s of SECRETS) expect(detectSecret(`here is my key: ${s} thanks`), s).not.toBeNull();
    expect(detectSecret("my stripe key is sk_live_" + "9".repeat(30))?.kind).toBe("stripe_secret_key");
  });

  it("leaves ordinary text alone", () => {
    for (const s of [
      "Connect Stripe so invoices can be paid online",
      "acct_1ABCDEF234 is our Stripe account id",
      "phone number id 555666777888",
      "00000000-0000-4000-8000-000000000001",
      "https://dashboard.stripe.com/settings/connect",
      "Please reset your password: click the link we sent",
      "task-planning-board-for-the-desk-team-2026",
    ])
      expect(detectSecret(s), s).toBeNull();
  });

  it("scans nested tool input", () => {
    expect(detectSecretIn({ a: [{ b: { note: "token " + SECRETS[0] } }] })).not.toBeNull();
    expect(detectSecretIn({ provider: "stripe" })).toBeNull();
  });
});

describe("guide_account_connection refuses secrets", () => {
  it("has no input that could carry a credential", async () => {
    await loadTools();
    const tool = getTool("guide_account_connection")!;
    expect(tool).toBeDefined();
    expect(tool.input.safeParse({ provider: "stripe" }).success).toBe(true);
    expect(tool.input.safeParse({}).success).toBe(true);
    for (const extra of [{ apiKey: "x" }, { token: "x" }, { secret: "x" }, { provider: "stripe", key: "x" }]) expect(tool.input.safeParse(extra).success).toBe(false);
    expect(tool.input.safeParse({ provider: "openai" }).success).toBe(false); // platform-managed: nothing to connect
    expect(JSON.stringify(tool.modelSchema)).not.toMatch(/apiKey|token|secret|password/i);
    expect(tool.permissions).toEqual(["integrations.read"]);
    expect(tool.autonomy).toBe("AUTONOMOUS");
  });

  it("the gateway refuses a pasted key before validation, execution or storage, and tells the person to use Connect", async () => {
    for (const s of SECRETS) {
      const err = await requestTool("guide_account_connection", { provider: s }, run).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, s).toBeInstanceOf(ToolDenied);
      expect((err as ToolDenied).code).toBe("secret_refused");
      expect((err as ToolDenied).message).toBe(SECRET_REFUSAL);
      expect((err as ToolDenied).message).toContain("Connect");
      expect((err as ToolDenied).message).not.toContain(s);
    }
    // Any tool, any field: a key smuggled into another tool's input is refused the same way.
    await expect(requestTool("read_integrations", { note: "use " + SECRETS[0] }, run)).rejects.toMatchObject({ code: "secret_refused" });
  });
});
