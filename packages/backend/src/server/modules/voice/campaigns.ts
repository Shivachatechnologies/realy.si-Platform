import "server-only";
import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { requestTool } from "@/server/modules/tools/gateway";
import { actorId, authorize, isUuid, LIVE_STATUSES, uuid } from "./common";
import { resolveSubject, type CallSubject } from "./calls";

/**
 * Outbound call lists. A campaign is approved as a whole (run_voice_campaign: SUPERVISED + HIGH, the approval lists how
 * many people will be called). Once approved its calls are dialled by the worker inside each callee's calling window,
 * a few at a time, skipping anyone who lands on the do-not-call list in the meantime.
 */

export const MAX_TARGETS = 200;

export const campaignInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    agentId: uuid,
    numberId: uuid,
    purpose: z.string().trim().min(3).max(1000),
    leadIds: z.array(uuid).max(MAX_TARGETS).default([]),
    contactIds: z.array(uuid).max(MAX_TARGETS).default([]),
  })
  .strict()
  .refine((v) => v.leadIds.length + v.contactIds.length > 0, { message: "Add at least one person to call" })
  .refine((v) => v.leadIds.length + v.contactIds.length <= MAX_TARGETS, { message: `At most ${MAX_TARGETS} people per campaign` });

export async function listCampaigns(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  const rows = await db().voiceCampaign.findMany({ where: { organizationId, companyId }, orderBy: { createdAt: "desc" }, take: 100, include: { agent: { select: { id: true, name: true } }, number: { select: { id: true, number: true } } } });
  const counts = await db().voiceCall.groupBy({ by: ["campaignId", "status"], where: { organizationId, companyId, campaignId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
  return rows.map((r) => {
    const mine = counts.filter((c) => c.campaignId === r.id);
    const n = (statuses: string[]) => mine.filter((c) => statuses.includes(c.status)).reduce((s, c) => s + c._count._all, 0);
    return { ...r, total: n(["AWAITING_APPROVAL", "SCHEDULED", "QUEUED", "RINGING", "IN_PROGRESS", "ENDED", "FAILED", "BLOCKED", "CANCELLED", "REJECTED"]), done: n(["ENDED"]), pending: n(["AWAITING_APPROVAL", "SCHEDULED", ...LIVE_STATUSES]), skipped: n(["FAILED", "BLOCKED", "CANCELLED", "REJECTED"]) };
  });
}

/** Create a campaign (people without a valid number or on the do-not-call list are skipped and reported) and file its approval. */
export async function createCampaign(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof campaignInput>) {
  const input = campaignInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "communication.post");
  const agent = await db().voiceAgent.findFirst({ where: { id: input.agentId, organizationId, companyId, archivedAt: null } });
  if (!agent) throw notFound("Agent");
  if (agent.syncStatus !== "SYNCED") throw invalid("Sync the agent with the provider first", { reason: "voice_agent_not_synced" });
  const number = await db().voicePhoneNumber.findFirst({ where: { id: input.numberId, organizationId, companyId, releasedAt: null } });
  if (!number) throw notFound("Phone number");
  if (number.provider !== agent.provider) throw invalid("The agent and the number must be on the same provider", { reason: "voice_provider_mismatch" });

  const targets: CallSubject[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const [kind, ids] of [["lead", input.leadIds], ["contact", input.contactIds]] as const) {
    for (const id of [...new Set(ids)]) {
      try {
        const s = await resolveSubject(organizationId, companyId, kind === "lead" ? { leadId: id } : { contactId: id });
        if (seen.has(s.phone)) {
          skipped.push({ id, reason: "duplicate_number" });
          continue;
        }
        seen.add(s.phone);
        targets.push(s);
      } catch (err) {
        const reason = err instanceof AppError && typeof err.details?.reason === "string" ? err.details.reason : "not_found";
        skipped.push({ id, reason });
      }
    }
  }
  if (!targets.length) throw invalid("Nobody on this list can be called (missing or invalid numbers, or do-not-call)", { reason: "voice_campaign_empty", skipped });

  const campaign = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.post", tx);
    const c = await tx.voiceCampaign.create({ data: { organizationId, companyId, name: input.name, agentId: agent.id, numberId: number.id, purpose: input.purpose, status: "AWAITING_APPROVAL", createdById: actorId(ctx, organizationId) } });
    await tx.voiceCall.createMany({
      data: targets.map((t) => ({
        organizationId,
        companyId,
        direction: "OUTBOUND" as const,
        status: "AWAITING_APPROVAL" as const,
        provider: agent.provider,
        agentId: agent.id,
        numberId: number.id,
        campaignId: c.id,
        toNumber: t.phone,
        fromNumber: number.number,
        leadId: t.leadId,
        contactId: t.contactId,
        subjectName: t.name,
        purpose: input.purpose,
        requestedById: actorId(ctx, organizationId),
      })),
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voice.campaign.created", resourceType: "voice_campaign", resourceId: c.id, newValue: { name: c.name, targets: targets.length, skipped: skipped.length } });
    return c;
  });
  const r = await requestTool("run_voice_campaign", { campaignId: campaign.id, name: campaign.name, people: targets.length }, { ctx, organizationId, companyId, allowedTools: ["run_voice_campaign"], profileKey: "voice_caller", taskId: null });
  if (r.status === "approval_requested") await db().voiceCampaign.update({ where: { id: campaign.id }, data: { approvalId: r.approvalId } });
  return { campaignId: campaign.id, targets: targets.length, skipped, approvalId: r.status === "approval_requested" ? r.approvalId : null };
}

/** Approved: the campaign starts; its calls are scheduled for the dialer. */
export async function startApprovedCampaign(organizationId: string, companyId: string, campaignId: string) {
  const c = await db().voiceCampaign.findFirst({ where: { id: campaignId, organizationId, companyId } });
  if (!c) throw notFound("Campaign");
  if (c.status !== "AWAITING_APPROVAL" && c.status !== "DRAFT") return { started: false, detail: `The campaign is ${c.status.toLowerCase()}; nothing changed.` };
  const now = new Date();
  const [{ count }] = await Promise.all([
    db().voiceCall.updateMany({ where: { campaignId, status: "AWAITING_APPROVAL" }, data: { status: "SCHEDULED", scheduledFor: now } }),
    db().voiceCampaign.update({ where: { id: campaignId }, data: { status: "RUNNING", startedAt: now } }),
  ]);
  return { started: true, detail: `Campaign "${c.name}" started: ${count} calls scheduled within calling hours.` };
}

export const campaignActionInput = z.object({ action: z.enum(["pause", "resume", "cancel"]) }).strict();

export async function campaignAction(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof campaignActionInput>) {
  const { action } = campaignActionInput.parse(raw);
  if (!isUuid(id)) throw notFound("Campaign");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.post", tx);
    const c = await tx.voiceCampaign.findFirst({ where: { id, organizationId, companyId } });
    if (!c) throw notFound("Campaign");
    const allowed = { pause: ["RUNNING"], resume: ["PAUSED"], cancel: ["AWAITING_APPROVAL", "RUNNING", "PAUSED", "DRAFT"] }[action];
    if (!allowed.includes(c.status)) throw new AppError("conflict", `A ${c.status.toLowerCase()} campaign can't be ${action}d`, { reason: "voice_campaign_state" });
    const status = action === "pause" ? "PAUSED" : action === "resume" ? "RUNNING" : "CANCELLED";
    await tx.voiceCampaign.update({ where: { id }, data: { status, ...(action === "cancel" ? { completedAt: new Date() } : {}) } });
    if (action === "cancel") await tx.voiceCall.updateMany({ where: { campaignId: id, status: { in: ["AWAITING_APPROVAL", "SCHEDULED"] } }, data: { status: "CANCELLED", blockedReason: "campaign_cancelled" } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `voice.campaign.${action}`, resourceType: "voice_campaign", resourceId: id });
    return { ok: true, status };
  });
}

/** Worker: running campaigns with nothing left to dial or in progress are completed. */
export async function completeCampaigns(): Promise<number> {
  const running = await db().voiceCampaign.findMany({ where: { status: "RUNNING" }, select: { id: true }, take: 200 });
  let n = 0;
  for (const c of running) {
    const open = await db().voiceCall.count({ where: { campaignId: c.id, status: { in: ["AWAITING_APPROVAL", "SCHEDULED", ...LIVE_STATUSES] } } });
    if (!open) {
      await db().voiceCampaign.update({ where: { id: c.id }, data: { status: "COMPLETED", completedAt: new Date() } });
      n++;
    }
  }
  return n;
}
