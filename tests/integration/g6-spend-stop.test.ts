import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/server/core/db";
import { createOrganization } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { sendSms, sendWhatsApp } from "@/server/modules/integrations/services/messaging";
import { generateImage } from "@/server/modules/integrations/services/images";
import { generateText } from "@/server/modules/integrations/services/ai-text";
import { generateVoiceover } from "@/server/modules/integrations/services/voiceover";
import { startVideoJob } from "@/server/modules/integrations/services/video";
import { makeUser, resetDb } from "../helpers";

// B29: provider spend outside agent tasks stops at a hard-stop cost budget, before any provider call.

beforeAll(resetDb);
afterEach(() => vi.unstubAllGlobals());

async function companyOverBudget(hardStop: boolean) {
  const owner = await makeUser();
  const org = await createOrganization(owner.ctx, { name: `Spend ${Math.random()}` });
  const company = await createCompany(owner.ctx, org.id, { name: "Spend Co" });
  await db().costBudget.create({ data: { organizationId: org.id, companyId: company.id, scope: "COMPANY", scopeKey: "*", limitMicros: 1_000_000n, hardStop, updatedById: owner.user.id } });
  await db().costLedgerEntry.create({ data: { organizationId: org.id, companyId: company.id, category: "IMAGE", provider: "openai", operation: "images.generate", sourceType: "test", sourceId: `t-${Math.random()}`, costMicros: 1_500_000n } });
  return { org, company };
}

describe("spend hard stop for provider services", () => {
  it("refuses image, video, voice, SMS, WhatsApp and AI text once the company budget is reached; nothing is sent", async () => {
    const { org, company } = await companyOverBudget(true);
    const fetch = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetch);
    const results = await Promise.all([
      generateImage(org.id, company.id, { prompt: "a lighthouse" }),
      startVideoJob(org.id, company.id, { prompt: "a lighthouse at dusk" }),
      generateVoiceover(org.id, company.id, { text: "Hello there" }),
      sendSms(org.id, company.id, { to: "+15551234567", body: "hi" }),
      sendWhatsApp(org.id, company.id, { to: "+15551234567", body: "hi" }),
      generateText(org.id, company.id, { prompt: "Write a tagline" }),
    ]);
    for (const r of results) expect(r).toMatchObject({ ok: false, code: "budget_reached", error: expect.stringMatching(/budget is reached; nothing was spent/) });
    expect(fetch).not.toHaveBeenCalled();
    expect(await db().costAlert.count({ where: { companyId: company.id } })).toBeGreaterThan(0);
  });

  it("an alert-only budget does not block (the call proceeds to the connection check)", async () => {
    const { org, company } = await companyOverBudget(false);
    expect(await sendSms(org.id, company.id, { to: "+15551234567", body: "hi" })).toMatchObject({ ok: false, code: "not_connected" });
  });
});
