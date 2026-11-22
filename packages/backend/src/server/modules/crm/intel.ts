import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { webSearch, type WebResult } from "@/server/modules/integrations/services/research";
import { generateText } from "@/server/modules/integrations/services/ai-text";
import { actorId, authorize, isUuid } from "./common";
import { isWorkEmail, normalizeEmail } from "./scoring";
import { leadEventData, updateLead } from "./service";
import { aiPaused, assertAiAllowed } from "./channels";

/**
 * Lead / account intelligence.
 * - Enrichment: a connected research provider looks the organisation up on the web; when an AI text provider is
 *   connected too, it extracts short facts ONLY from those sources (each fact keeps its source URL). Without research
 *   nothing is stored ("credential required").
 * - Qualification: an AI text provider rates fit 0–100 against BANT with plain-language reasons and lists what is
 *   still missing. A person decides whether to apply the suggested BANT answers.
 */

export interface IntelFact {
  label: string;
  value: string;
  sourceUrl: string | null;
}
export interface IntelSource {
  title: string;
  url: string;
  snippet: string;
}
export interface Qualification {
  verdict: "qualified" | "nurture" | "disqualify" | "need_info";
  reasons: { text: string; positive: boolean }[];
  missing: string[];
  bant: { budget: string | null; authority: string | null; need: string | null; timeline: string | null };
}

const SOURCES_MAX = 6;

/** First JSON object in a model reply (models sometimes wrap it in prose or code fences). */
function parseJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const factSchema = z.object({ label: z.string().trim().min(1).max(60), value: z.string().trim().min(1).max(300), source: z.number().int().min(1).max(SOURCES_MAX) });
const enrichReply = z.object({ summary: z.string().trim().max(800).default(""), facts: z.array(z.unknown()).max(12).default([]) });
const qualifyReply = z.object({
  fit: z.number().min(0).max(100),
  verdict: z.enum(["qualified", "nurture", "disqualify", "need_info"]),
  summary: z.string().trim().max(800).default(""),
  reasons: z.array(z.object({ text: z.string().trim().min(1).max(300), positive: z.boolean() })).max(8).default([]),
  missing: z.array(z.string().trim().min(1).max(200)).max(6).default([]),
  bant: z
    .object({ budget: z.string().max(500).nullable().optional(), authority: z.string().max(500).nullable().optional(), need: z.string().max(1000).nullable().optional(), timeline: z.string().max(500).nullable().optional() })
    .default({}),
});

async function research(organizationId: string, companyId: string, query: string) {
  const r = await webSearch(organizationId, companyId, query, { maxResults: SOURCES_MAX });
  if (!r.ok) {
    if (r.code === "not_connected") throw new AppError("not_configured", "No research provider is connected; nothing was looked up.", { reason: "crm_research_not_connected" });
    throw new AppError("not_available", `The research provider could not answer: ${r.error}`, { reason: "crm_research_failed" });
  }
  return { provider: r.providerId, results: r.data.results.slice(0, SOURCES_MAX) };
}

/** Facts extracted by AI from the given sources only (empty when no AI text provider is connected or it fails). */
async function extractFacts(organizationId: string, companyId: string, subject: string, results: WebResult[]) {
  if (!results.length || (await aiPaused(organizationId, companyId))) return { summary: "", facts: [] as IntelFact[], model: null as string | null, provider: null as string | null };
  const numbered = results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n");
  const ai = await generateText(organizationId, companyId, {
    system:
      "You extract business facts for a salesperson. Use ONLY the numbered sources provided. Never guess or add outside knowledge. If a source is about a different organisation, ignore it. Reply with JSON only.",
    prompt: `Organisation: ${subject}\n\nSources:\n${numbered}\n\nReturn JSON: {"summary": "<2 plain sentences about what this organisation does, or empty if the sources don't say>", "facts": [{"label": "<short label like Industry, Location, Size, Products, Recent news, Website>", "value": "<short value>", "source": <source number>}]}. At most 8 facts.`,
    maxOutputTokens: 700,
    temperature: 0.1,
  });
  if (!ai.ok) return { summary: "", facts: [], model: null, provider: null };
  const parsed = enrichReply.safeParse(parseJson(ai.data.text));
  if (!parsed.success) return { summary: "", facts: [], model: ai.data.model, provider: ai.providerId };
  const facts: IntelFact[] = [];
  for (const raw of parsed.data.facts) {
    const f = factSchema.safeParse(raw);
    if (f.success && results[f.data.source - 1]) facts.push({ label: f.data.label, value: f.data.value, sourceUrl: results[f.data.source - 1]!.url });
  }
  return { summary: parsed.data.summary, facts, model: ai.data.model, provider: ai.providerId };
}

const toSources = (results: WebResult[]): IntelSource[] => results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet.slice(0, 400) }));

export async function enrichLead(ctx: RequestContext, organizationId: string, companyId: string, leadId: string) {
  await authorize(ctx, organizationId, companyId, "sales.manage");
  if (!isUuid(leadId)) throw notFound("Lead");
  const lead = await db().lead.findFirst({ where: { id: leadId, organizationId, companyId, archivedAt: null } });
  if (!lead) throw notFound("Lead");
  const domain = isWorkEmail(lead.email) ? normalizeEmail(lead.email)!.split("@")[1]! : null;
  const subject = lead.account?.trim() || domain || null;
  if (!subject) throw invalid("Add the lead's company name or a work email first, so we know what to look up.", { reason: "crm_enrich_needs_company" });
  const query = [lead.account?.trim(), domain ? `site:${domain} OR ${domain}` : null].filter(Boolean).join(" ");
  const { provider, results } = await research(organizationId, companyId, query);
  const extracted = await extractFacts(organizationId, companyId, `${subject}${domain ? ` (${domain})` : ""}`, results);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const intel = await tx.crmIntel.create({
      data: {
        organizationId,
        companyId,
        kind: "ENRICHMENT",
        leadId,
        summary: extracted.summary,
        data: { facts: extracted.facts } as unknown as Prisma.InputJsonValue,
        sources: toSources(results) as unknown as Prisma.InputJsonValue,
        provider: [provider, extracted.provider].filter(Boolean).join(" + "),
        model: extracted.model,
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "lead.enriched", resourceType: "lead", resourceId: leadId, newValue: { sources: results.length, facts: extracted.facts.length, provider } });
    await emitDomainEvent(tx, ctx, "lead.updated", { organizationId, companyId, entityType: "lead", entityId: leadId, data: { ...leadEventData(lead), change: "enriched", enrichmentFacts: extracted.facts.length } });
    return { id: intel.id, sources: results.length, facts: extracted.facts.length, aiUsed: !!extracted.provider };
  });
}

export async function enrichAccount(ctx: RequestContext, organizationId: string, companyId: string, accountId: string) {
  await authorize(ctx, organizationId, companyId, "sales.manage");
  if (!isUuid(accountId)) throw notFound("Account");
  const a = await db().account.findFirst({ where: { id: accountId, organizationId, companyId, archivedAt: null }, select: { id: true, name: true, domain: true, website: true } });
  if (!a) throw notFound("Account");
  let domain = a.domain?.trim() || null;
  if (!domain && a.website) {
    try {
      domain = new URL(/^https?:\/\//.test(a.website) ? a.website : `https://${a.website}`).hostname.replace(/^www\./, "");
    } catch {
      domain = null;
    }
  }
  const { provider, results } = await research(organizationId, companyId, [a.name, domain].filter(Boolean).join(" "));
  const extracted = await extractFacts(organizationId, companyId, `${a.name}${domain ? ` (${domain})` : ""}`, results);
  return transaction(async (tx) => {
    const intel = await tx.crmIntel.create({
      data: {
        organizationId,
        companyId,
        kind: "ENRICHMENT",
        accountId,
        summary: extracted.summary,
        data: { facts: extracted.facts } as unknown as Prisma.InputJsonValue,
        sources: toSources(results) as unknown as Prisma.InputJsonValue,
        provider: [provider, extracted.provider].filter(Boolean).join(" + "),
        model: extracted.model,
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "account.enriched", resourceType: "account", resourceId: accountId, newValue: { sources: results.length, facts: extracted.facts.length, provider } });
    return { id: intel.id, sources: results.length, facts: extracted.facts.length, aiUsed: !!extracted.provider };
  });
}

export async function qualifyLead(ctx: RequestContext, organizationId: string, companyId: string, leadId: string) {
  await authorize(ctx, organizationId, companyId, "sales.manage");
  if (!isUuid(leadId)) throw notFound("Lead");
  const lead = await db().lead.findFirst({
    where: { id: leadId, organizationId, companyId, archivedAt: null },
    include: { activities: { orderBy: { occurredAt: "desc" }, take: 8, select: { type: true, summary: true, occurredAt: true } } },
  });
  if (!lead) throw notFound("Lead");
  await assertAiAllowed(organizationId, companyId);
  const enrichment = await db().crmIntel.findFirst({ where: { companyId, leadId, kind: "ENRICHMENT" }, orderBy: { createdAt: "desc" }, select: { summary: true, data: true } });
  const company = await db().company.findFirst({ where: { id: companyId, organizationId }, select: { name: true } });
  const facts = ((enrichment?.data as { facts?: IntelFact[] } | null)?.facts ?? []).map((f) => `- ${f.label}: ${f.value}`).join("\n");
  const record = [
    `Name: ${lead.name}`,
    `Organisation: ${lead.account ?? "unknown"}`,
    `Email: ${lead.email ? (isWorkEmail(lead.email) ? "work address" : "personal address") : "none"}`,
    `Phone: ${lead.phone ? "yes" : "none"}`,
    `Stage: ${lead.stage}`,
    `Estimated value: ${lead.valueMinor != null ? `${lead.valueMinor} minor units ${lead.currency}` : "unknown"}`,
    `Source: ${lead.source ?? "unknown"}`,
    `Budget: ${lead.budget ?? "unknown"}; Authority: ${lead.authority ?? "unknown"}; Need: ${lead.need ?? "unknown"}; Timeline: ${lead.timeline ?? "unknown"}`,
    `Notes: ${(lead.notes ?? "").slice(0, 1500) || "none"}`,
    `Recent activity:\n${lead.activities.map((a) => `- ${a.occurredAt.toISOString().slice(0, 10)} ${a.type}: ${a.summary.slice(0, 200)}`).join("\n") || "none"}`,
    enrichment ? `Web research summary: ${enrichment.summary || "none"}\n${facts}` : "Web research: none yet",
  ].join("\n");
  const ai = await generateText(organizationId, companyId, {
    system:
      "You are a careful sales qualification assistant for a small business. Judge ONLY from the record provided; when something is unknown say so instead of assuming. Use plain, friendly language a beginner understands. Reply with JSON only.",
    prompt: `We are ${company?.name ?? "a small business"}. Qualify this lead.\n\n${record}\n\nReturn JSON: {"fit": <0-100 how likely this becomes a paying customer>, "verdict": "qualified" | "nurture" | "disqualify" | "need_info", "summary": "<one or two sentences>", "reasons": [{"text": "<reason>", "positive": true|false}], "missing": ["<question to ask the lead>"], "bant": {"budget": <short text or null>, "authority": <short text or null>, "need": <short text or null>, "timeline": <short text or null>}}. Only fill bant values that the record actually supports.`,
    maxOutputTokens: 800,
    temperature: 0.2,
  });
  if (!ai.ok) {
    if (ai.code === "not_connected") throw new AppError("not_configured", "No AI text provider (OpenAI or Gemini) is connected; nothing was scored.", { reason: "crm_ai_not_connected" });
    throw new AppError("not_available", `The AI provider could not answer: ${ai.error}`, { reason: "crm_ai_failed" });
  }
  const parsed = qualifyReply.safeParse(parseJson(ai.data.text));
  if (!parsed.success) throw new AppError("not_available", "The AI answer could not be read; nothing was saved. Please try again.", { reason: "crm_ai_unreadable" });
  const q = parsed.data;
  const data: Qualification = {
    verdict: q.verdict,
    reasons: q.reasons,
    missing: q.missing,
    bant: { budget: q.bant.budget ?? null, authority: q.bant.authority ?? null, need: q.bant.need ?? null, timeline: q.bant.timeline ?? null },
  };
  return transaction(async (tx) => {
    const intel = await tx.crmIntel.create({
      data: {
        organizationId,
        companyId,
        kind: "QUALIFICATION",
        leadId,
        summary: q.summary,
        fitScore: Math.round(q.fit),
        data: data as unknown as Prisma.InputJsonValue,
        provider: ai.providerId,
        model: ai.data.model,
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "lead.ai_qualified", resourceType: "lead", resourceId: leadId, newValue: { fit: Math.round(q.fit), verdict: q.verdict, provider: ai.providerId } });
    await emitDomainEvent(tx, ctx, "lead.updated", { organizationId, companyId, entityType: "lead", entityId: leadId, data: { ...leadEventData(lead), change: "ai_qualified", aiFit: Math.round(q.fit), aiVerdict: q.verdict } });
    return { id: intel.id, fit: Math.round(q.fit), verdict: q.verdict };
  });
}

/** Copy the AI's BANT suggestions into the lead (a person clicked "Use these answers"); qualified only if verdict says so. */
export async function applyQualification(ctx: RequestContext, organizationId: string, companyId: string, intelId: string) {
  await authorize(ctx, organizationId, companyId, "sales.manage");
  if (!isUuid(intelId)) throw notFound("Qualification");
  const intel = await db().crmIntel.findFirst({ where: { id: intelId, organizationId, companyId, kind: "QUALIFICATION", leadId: { not: null } } });
  if (!intel?.leadId) throw notFound("Qualification");
  const q = intel.data as unknown as Qualification;
  const patch: Record<string, string | boolean> = {};
  for (const k of ["budget", "authority", "need", "timeline"] as const) if (q.bant?.[k]) patch[k] = q.bant[k]!.slice(0, k === "need" ? 1000 : 500);
  if (q.verdict === "qualified") patch.qualified = true;
  return updateLead(ctx, organizationId, companyId, intel.leadId, patch);
}

export async function latestIntel(ctx: RequestContext, organizationId: string, companyId: string, subject: { leadId?: string; accountId?: string }) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const where = { organizationId, companyId, ...(subject.leadId ? { leadId: subject.leadId } : { accountId: subject.accountId }) };
  const [enrichment, qualification] = await Promise.all([
    db().crmIntel.findFirst({ where: { ...where, kind: "ENRICHMENT" }, orderBy: { createdAt: "desc" } }),
    subject.leadId ? db().crmIntel.findFirst({ where: { ...where, kind: "QUALIFICATION" }, orderBy: { createdAt: "desc" } }) : Promise.resolve(null),
  ]);
  return {
    enrichment: enrichment ? { id: enrichment.id, createdAt: enrichment.createdAt, summary: enrichment.summary, provider: enrichment.provider, facts: ((enrichment.data as { facts?: IntelFact[] }).facts ?? []) as IntelFact[], sources: enrichment.sources as unknown as IntelSource[] } : null,
    qualification: qualification
      ? { id: qualification.id, createdAt: qualification.createdAt, summary: qualification.summary, fit: qualification.fitScore ?? 0, provider: qualification.provider, model: qualification.model, ...(qualification.data as unknown as Qualification) }
      : null,
  };
}
