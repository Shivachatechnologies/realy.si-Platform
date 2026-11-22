import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { userContext } from "@/server/core/context";
import { createOrganization } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { callingBlocked, dialCall, dialDueCalls } from "@/server/modules/voice/calls";
import { campaignAction, startApprovedCampaign } from "@/server/modules/voice/campaigns";
import { makeUser, raiseLimits, resetDb } from "../helpers";

/**
 * B5 (G5): the company kill switch ("Pause all AI", autonomy settings) stops AI calling — due calls wait instead of
 * being dialled, approved campaigns and runs do not start, a paused campaign cannot be resumed — and nothing is
 * dialled again until AI is resumed.
 */

let s: { orgId: string; companyId: string; userId: string };

async function setPaused(paused: boolean) {
  await db().autonomySettings.upsert({
    where: { companyId: s.companyId },
    create: { organizationId: s.orgId, companyId: s.companyId, paused, pausedAt: paused ? new Date() : null },
    update: { paused, pausedAt: paused ? new Date() : null },
  });
}

beforeAll(async () => {
  await resetDb();
  const owner = await makeUser({ name: "Kill Switch Owner" });
  const org = await createOrganization(owner.ctx, { name: `Voice KS ${Math.random()}` });
  await raiseLimits(org.id, { "companies.max": 2 });
  const company = await createCompany(owner.ctx, org.id, { name: "Paused Calls Ltd", incorporationCountryCode: "DE" });
  s = { orgId: org.id, companyId: company.id, userId: owner.user.id };
});
afterAll(async () => {
  await db().autonomySettings.deleteMany({ where: { companyId: s.companyId } });
});

describe("voice calling honours the company kill switch", () => {
  it("reports company_ai_paused and keeps due calls waiting", async () => {
    await setPaused(true);
    expect(await callingBlocked(s.orgId, s.companyId)).toBe("company_ai_paused");
    const call = await db().voiceCall.create({ data: { organizationId: s.orgId, companyId: s.companyId, direction: "OUTBOUND", status: "SCHEDULED", toNumber: "+4915112345678", scheduledFor: new Date(Date.now() - 60_000) } });
    const r = await dialCall(call.id);
    expect(r.status).toBe("SCHEDULED");
    expect(r.detail).toMatch(/company ai paused/);
    expect(await dialDueCalls()).toBe(0);
    const after = await db().voiceCall.findUniqueOrThrow({ where: { id: call.id } });
    expect(after.status).toBe("SCHEDULED");
    expect(after.externalCallId).toBeNull();
  });

  it("does not start an approved campaign or resume a paused one while AI is paused", async () => {
    await setPaused(true);
    const agent = await db().voiceAgent.create({ data: { organizationId: s.orgId, companyId: s.companyId, name: "Caller", goal: "BOOK_MEETING", provider: "VAPI", syncStatus: "SYNCED", externalAgentId: "ext", createdById: s.userId } });
    const number = await db().voicePhoneNumber.create({ data: { organizationId: s.orgId, companyId: s.companyId, provider: "VAPI", externalId: "num", number: "+4930123456" } });
    const camp = await db().voiceCampaign.create({ data: { organizationId: s.orgId, companyId: s.companyId, name: "Q4", agentId: agent.id, numberId: number.id, status: "AWAITING_APPROVAL", createdById: s.userId } });
    await expect(startApprovedCampaign(s.orgId, s.companyId, camp.id)).rejects.toMatchObject({ details: { reason: "company_ai_paused" } });
    expect((await db().voiceCampaign.findUniqueOrThrow({ where: { id: camp.id } })).status).toBe("AWAITING_APPROVAL");

    await db().voiceCampaign.update({ where: { id: camp.id }, data: { status: "PAUSED" } });
    await expect(campaignAction(userContext(s.userId, { mfaVerifiedAt: new Date() }), s.orgId, s.companyId, camp.id, { action: "resume" })).rejects.toMatchObject({ details: { reason: "company_ai_paused" } });
  });

  it("lets calling continue once AI is resumed", async () => {
    await setPaused(false);
    expect(await callingBlocked(s.orgId, s.companyId)).not.toBe("company_ai_paused");
  });
});
