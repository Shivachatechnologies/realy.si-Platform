import "server-only";
import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { getConnection } from "@/server/modules/integrations/connections";
import { ProviderError } from "@/server/modules/integrations/providers";
import { actorId, authorize, GOALS, isUuid, LANGUAGES, PROVIDER_KEY, uuid } from "./common";
import { buildKnowledge, openingLine, systemPrompt } from "./knowledge";
import { upsertAgent, webhookUrl } from "./providers";
import { ensureSettings, providerLabel, settingsInput, updateSettings, vapiSecret } from "./service";

/** Voice agents: an AI employee's phone persona, compiled from company knowledge and pushed to Vapi / Retell. */

const blank = z.literal("").transform(() => undefined);
export const agentInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    aiEmployeeId: uuid.optional().or(blank).nullable(),
    goal: z.enum(GOALS),
    language: z.enum(LANGUAGES).default("en-US"),
    voiceId: z.string().trim().max(80).regex(/^[A-Za-z0-9 ._:-]*$/).optional(),
    greeting: z.string().trim().max(400).optional(),
    instructions: z.string().trim().max(3000).optional(),
    offerNotes: z.string().trim().max(3000).optional(),
  })
  .strict();
export const agentPatch = agentInput.partial().strict();

async function requireEmployee(organizationId: string, companyId: string, id: string | null | undefined) {
  if (!id) return null;
  const e = await db().aiEmployee.findFirst({ where: { id, organizationId, companyId }, select: { id: true, name: true, jobTitle: true, instructions: true, status: true } });
  if (!e) throw invalid("Pick an AI employee of this company", { reason: "voice_employee_invalid" });
  return e;
}

export async function listAgents(ctx: RequestContext, organizationId: string, companyId: string, opts: { includeArchived?: boolean } = {}) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  const rows = await db().voiceAgent.findMany({
    where: { organizationId, companyId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
    orderBy: { createdAt: "asc" },
    include: { numbers: { where: { releasedAt: null }, select: { id: true, number: true } }, _count: { select: { calls: true } } },
  });
  const employees = await db().aiEmployee.findMany({ where: { organizationId, companyId, id: { in: rows.map((r) => r.aiEmployeeId).filter((x): x is string => !!x) } }, select: { id: true, name: true, profileKey: true, jobTitle: true } });
  const byId = new Map(employees.map((e) => [e.id, e]));
  return rows.map((r) => ({ ...r, knowledge: undefined, hasKnowledge: !!r.knowledge, employee: r.aiEmployeeId ? (byId.get(r.aiEmployeeId) ?? null) : null }));
}

export async function getAgent(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  if (!isUuid(id)) throw notFound("Agent");
  const a = await db().voiceAgent.findFirst({ where: { id, organizationId, companyId }, include: { numbers: { where: { releasedAt: null }, select: { id: true, number: true, label: true } } } });
  if (!a) throw notFound("Agent");
  const [settings, company, employee] = await Promise.all([
    ensureSettings(db(), organizationId, companyId),
    db().company.findFirst({ where: { id: companyId }, select: { name: true } }),
    a.aiEmployeeId ? db().aiEmployee.findFirst({ where: { id: a.aiEmployeeId, organizationId, companyId }, select: { id: true, name: true, jobTitle: true, instructions: true } }) : Promise.resolve(null),
  ]);
  const opening = openingLine(a, company?.name ?? "", settings.recordCalls);
  const prompt = systemPrompt({ agentName: a.name, companyName: company?.name ?? "", goal: a.goal, language: a.language, recordCalls: settings.recordCalls, employee, instructions: a.instructions, offerNotes: a.offerNotes, knowledge: a.knowledge });
  return { ...a, employee, opening, prompt };
}

/** AI employees that can be given a phone voice. */
export async function employeeOptions(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  return db().aiEmployee.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true, jobTitle: true, profileKey: true } });
}

export async function createAgent(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof agentInput>) {
  const input = agentInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "communication.manage");
  const settings = await ensureSettings(db(), organizationId, companyId);
  if (!settings.provider) throw invalid("Choose Vapi or Retell AI first", { reason: "voice_no_provider" });
  await requireEmployee(organizationId, companyId, input.aiEmployeeId);
  const knowledge = await buildKnowledge(ctx, organizationId, companyId);
  const agent = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.manage", tx);
    const a = await tx.voiceAgent.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        aiEmployeeId: input.aiEmployeeId || null,
        goal: input.goal,
        provider: settings.provider!,
        language: input.language,
        voiceId: input.voiceId || null,
        greeting: input.greeting || null,
        instructions: input.instructions || null,
        offerNotes: input.offerNotes || null,
        knowledge: knowledge.text || null,
        knowledgeBuiltAt: new Date(),
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voice.agent.created", resourceType: "voice_agent", resourceId: a.id, newValue: { name: a.name, goal: a.goal, provider: a.provider } });
    return a;
  });
  return syncAgentQuietly(organizationId, companyId, agent.id);
}

export async function updateAgent(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof agentPatch>) {
  const input = agentPatch.parse(raw);
  if (!isUuid(id)) throw notFound("Agent");
  if (input.aiEmployeeId) await requireEmployee(organizationId, companyId, input.aiEmployeeId);
  await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.manage", tx);
    const a = await tx.voiceAgent.findFirst({ where: { id, organizationId, companyId, archivedAt: null }, select: { id: true } });
    if (!a) throw notFound("Agent");
    await tx.voiceAgent.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.aiEmployeeId !== undefined ? { aiEmployeeId: input.aiEmployeeId || null } : {}),
        ...(input.goal !== undefined ? { goal: input.goal } : {}),
        ...(input.language !== undefined ? { language: input.language } : {}),
        ...(input.voiceId !== undefined ? { voiceId: input.voiceId || null } : {}),
        ...(input.greeting !== undefined ? { greeting: input.greeting || null } : {}),
        ...(input.instructions !== undefined ? { instructions: input.instructions || null } : {}),
        ...(input.offerNotes !== undefined ? { offerNotes: input.offerNotes || null } : {}),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voice.agent.updated", resourceType: "voice_agent", resourceId: id, newValue: { fields: Object.keys(input) } });
  });
  return syncAgentQuietly(organizationId, companyId, id);
}

/** Rebuild the knowledge pack from the Company Brain, products and help articles, then re-sync. */
export async function refreshKnowledge(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "communication.manage");
  if (!isUuid(id)) throw notFound("Agent");
  const a = await db().voiceAgent.findFirst({ where: { id, organizationId, companyId, archivedAt: null }, select: { id: true } });
  if (!a) throw notFound("Agent");
  const k = await buildKnowledge(ctx, organizationId, companyId);
  await transaction(async (tx) => {
    await tx.voiceAgent.update({ where: { id }, data: { knowledge: k.text || null, knowledgeBuiltAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voice.agent.knowledge_refreshed", resourceType: "voice_agent", resourceId: id, newValue: k.sources });
  });
  const synced = await syncAgentQuietly(organizationId, companyId, id);
  return { ...synced, sources: k.sources };
}

export async function syncAgent(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "communication.manage");
  if (!isUuid(id)) throw notFound("Agent");
  const r = await syncAgentQuietly(organizationId, companyId, id);
  if (r.syncStatus !== "SYNCED") {
    throw new AppError(r.credentialMissing ? "not_configured" : "conflict", r.syncError ?? "The agent could not be synced", { reason: r.credentialMissing ? "voice_credential_required" : "voice_sync_failed" });
  }
  return r;
}

/** Push the agent to its provider. Records the truth (SYNCED / ERROR + message); never throws for provider errors. */
export async function syncAgentQuietly(organizationId: string, companyId: string, id: string) {
  const a = await db().voiceAgent.findFirstOrThrow({ where: { id, organizationId, companyId } });
  const conn = await getConnection(organizationId, companyId, PROVIDER_KEY[a.provider]);
  if (!conn?.accessToken) {
    const u = await db().voiceAgent.update({ where: { id }, data: { syncStatus: a.externalAgentId ? "ERROR" : "DRAFT", syncError: `${providerLabel(a.provider)} is not connected` } });
    return { ...u, knowledge: undefined, credentialMissing: true };
  }
  const [settings, company, employee] = await Promise.all([
    ensureSettings(db(), organizationId, companyId),
    db().company.findFirst({ where: { id: companyId }, select: { name: true } }),
    a.aiEmployeeId ? db().aiEmployee.findFirst({ where: { id: a.aiEmployeeId, organizationId, companyId }, select: { name: true, jobTitle: true, instructions: true } }) : Promise.resolve(null),
  ]);
  const companyName = company?.name ?? "";
  try {
    const ids = await upsertAgent(
      a.provider,
      conn,
      {
        name: a.name,
        language: a.language,
        voiceId: a.voiceId,
        firstMessage: openingLine(a, companyName, settings.recordCalls),
        systemPrompt: systemPrompt({ agentName: a.name, companyName, goal: a.goal, language: a.language, recordCalls: settings.recordCalls, employee, instructions: a.instructions, offerNotes: a.offerNotes, knowledge: a.knowledge }),
        maxDurationSec: settings.maxDurationSec,
        recordCalls: settings.recordCalls,
        webhookUrl: webhookUrl(a.provider, settings.webhookKey),
        webhookSecret: a.provider === "VAPI" ? await vapiSecret(organizationId, companyId) : null,
        metadata: { realyCompanyId: companyId, realyAgentId: a.id },
      },
      { agentId: a.externalAgentId, llmId: a.externalLlmId },
    );
    const u = await db().voiceAgent.update({ where: { id }, data: { externalAgentId: ids.agentId, externalLlmId: ids.llmId, syncStatus: "SYNCED", syncError: null, syncedAt: new Date() } });
    return { ...u, knowledge: undefined, credentialMissing: false };
  } catch (err) {
    const message = (err instanceof ProviderError || err instanceof Error ? err.message : "sync failed").slice(0, 300);
    const u = await db().voiceAgent.update({ where: { id }, data: { syncStatus: "ERROR", syncError: message } });
    return { ...u, knowledge: undefined, credentialMissing: err instanceof ProviderError && (err.status === 401 || err.status === 403) };
  }
}

/** Re-sync every active agent (after settings that live in the provider config changed). */
export async function resyncAgents(organizationId: string, companyId: string) {
  const agents = await db().voiceAgent.findMany({ where: { organizationId, companyId, archivedAt: null }, select: { id: true } });
  for (const a of agents) await syncAgentQuietly(organizationId, companyId, a.id);
  return agents.length;
}

export async function archiveAgent(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Agent");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.manage", tx);
    const a = await tx.voiceAgent.findFirst({ where: { id, organizationId, companyId, archivedAt: null }, include: { numbers: { where: { releasedAt: null }, select: { id: true } } } });
    if (!a) throw notFound("Agent");
    if (a.numbers.length) throw invalid("This agent answers a phone number. Point the number at another agent first.", { reason: "voice_agent_in_use" });
    await tx.voiceAgent.update({ where: { id }, data: { archivedAt: new Date() } });
    await tx.voiceCall.updateMany({ where: { organizationId, companyId, agentId: id, status: { in: ["AWAITING_APPROVAL", "SCHEDULED"] } }, data: { status: "CANCELLED", blockedReason: "agent_archived" } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voice.agent.archived", resourceType: "voice_agent", resourceId: id });
    return { ok: true };
  });
}

/** Save settings; agents are re-synced when a rule that lives in the provider config (recording, duration) changed. */
export async function saveSettings(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof settingsInput>) {
  const input = settingsInput.parse(raw);
  const saved = await updateSettings(ctx, organizationId, companyId, input);
  const resynced = input.recordCalls !== undefined || input.maxDurationMin !== undefined ? await resyncAgents(organizationId, companyId) : 0;
  return { ...saved, resynced };
}
