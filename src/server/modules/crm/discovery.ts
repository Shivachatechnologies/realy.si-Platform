import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, conflict, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { webSearch } from "@/server/modules/integrations/services/research";
import { actorId, authorize, isUuid } from "./common";
import { createLead } from "./service";

/**
 * Lead discovery: the user describes who they sell to; a connected research provider (Tavily → Exa → SerpApi) returns
 * real web results, stored exactly as returned. Nothing is invented: with no provider connected the call fails with
 * "not_configured" and nothing is stored. A person picks which results become leads.
 */

export const discoverInput = z.object({
  audience: z.string().trim().min(3).max(300),
  location: z.string().trim().max(120).optional(),
  extra: z.string().trim().max(200).optional(),
  maxResults: z.number().int().min(3).max(20).default(10),
});
export const prospectAddInput = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().max(254).optional().or(z.literal("").transform(() => undefined)),
});

export const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
};

/** A readable company-ish name from a page title ("Acme Bakery | Fresh bread in Ljubljana" → "Acme Bakery"). */
export const nameFromTitle = (title: string, domain: string | null) => {
  const first = title.split(/\s[|\-–—:·]\s/)[0]?.trim();
  return (first && first.length >= 2 ? first : (domain ?? title)).slice(0, 200);
};

export async function discoverProspects(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof discoverInput>) {
  const input = discoverInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "sales.manage");
  const query = [input.audience, input.location ? `in ${input.location}` : "", input.extra ?? ""].filter(Boolean).join(" ").slice(0, 400);
  const r = await webSearch(organizationId, companyId, query, { maxResults: input.maxResults });
  if (!r.ok) {
    if (r.code === "not_connected") throw new AppError("not_configured", "No research provider is connected; nothing was searched.", { reason: "crm_research_not_connected" });
    throw new AppError("not_available", `The research provider could not answer: ${r.error}`, { reason: "crm_research_failed" });
  }
  const seen = new Set<string>();
  const rows = r.data.results.filter((x) => {
    if (seen.has(x.url)) return false;
    seen.add(x.url);
    return true;
  });
  return transaction(async (tx) => {
    const search = await tx.crmProspectSearch.create({
      data: { organizationId, companyId, query, audience: input.audience, provider: r.providerId, resultCount: rows.length, createdById: actorId(ctx, organizationId) },
    });
    if (rows.length) {
      await tx.crmProspect.createMany({
        data: rows.map((x) => ({
          organizationId,
          companyId,
          searchId: search.id,
          title: x.title.slice(0, 300) || x.url.slice(0, 300),
          url: x.url.slice(0, 2000),
          domain: domainOf(x.url),
          snippet: x.snippet.slice(0, 1000),
          publishedAt: x.publishedAt?.slice(0, 40) ?? null,
        })),
        skipDuplicates: true,
      });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.prospects.searched", resourceType: "crm_prospect_search", resourceId: search.id, newValue: { query, provider: r.providerId, results: rows.length } });
    return { id: search.id, provider: r.providerId, results: rows.length };
  });
}

export async function listProspectSearches(ctx: RequestContext, organizationId: string, companyId: string, take = 12) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  return db().crmProspectSearch.findMany({
    where: { organizationId, companyId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, query: true, audience: true, provider: true, resultCount: true, createdAt: true, _count: { select: { prospects: { where: { status: "ADDED" } } } } },
  });
}

/** Results of one search (or the latest), each flagged when a lead with the same email domain/company already exists. */
export async function prospectResults(ctx: RequestContext, organizationId: string, companyId: string, searchId?: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const search = await db().crmProspectSearch.findFirst({
    where: { organizationId, companyId, ...(searchId && isUuid(searchId) ? { id: searchId } : {}) },
    orderBy: { createdAt: "desc" },
    include: { prospects: { orderBy: { createdAt: "asc" } } },
  });
  if (!search) return null;
  const domains = [...new Set(search.prospects.map((p) => p.domain).filter((d): d is string => !!d))];
  const known = domains.length
    ? await db().lead.findMany({
        where: { organizationId, companyId, archivedAt: null, OR: domains.map((d) => ({ emailNormalized: { endsWith: `@${d}` } })) },
        select: { id: true, emailNormalized: true },
        take: 200,
      })
    : [];
  const knownDomain = new Map(known.map((l) => [l.emailNormalized?.split("@")[1] ?? "", l.id]));
  return {
    ...search,
    prospects: search.prospects.map((p) => ({ ...p, suggestedName: nameFromTitle(p.title, p.domain), knownLeadId: p.leadId ?? (p.domain ? (knownDomain.get(p.domain) ?? null) : null) })),
  };
}

async function loadProspect(organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Result");
  const p = await db().crmProspect.findFirst({ where: { id, organizationId, companyId }, include: { search: { select: { audience: true, query: true } } } });
  if (!p) throw notFound("Result");
  return p;
}

/** Create a lead from a discovery result (the person confirms or edits the name; an email only when they know one). */
export async function addProspectAsLead(ctx: RequestContext, organizationId: string, companyId: string, prospectId: string, raw: z.input<typeof prospectAddInput>) {
  const input = prospectAddInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "sales.manage");
  const p = await loadProspect(organizationId, companyId, prospectId);
  if (p.status === "ADDED" && p.leadId) throw conflict("This result is already a lead", { reason: "crm_prospect_added", leadId: p.leadId });
  const name = input.name ?? nameFromTitle(p.title, p.domain);
  const lead = await createLead(ctx, organizationId, companyId, {
    name,
    account: name,
    email: input.email,
    source: "Lead discovery",
    tags: ["discovered"],
    notes: `Found by web research for "${p.search.audience ?? p.search.query}".\n${p.url}\n\n${p.snippet}`.slice(0, 5000),
    allowDuplicate: false,
  });
  await transaction(async (tx) => {
    await tx.crmProspect.update({ where: { id: p.id }, data: { status: "ADDED", leadId: lead.id, decidedById: ctx.actor.id ?? null, decidedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.prospect.added", resourceType: "crm_prospect", resourceId: p.id, newValue: { leadId: lead.id, url: p.url } });
  });
  return { leadId: lead.id };
}

export async function dismissProspect(ctx: RequestContext, organizationId: string, companyId: string, prospectId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    if (!isUuid(prospectId)) throw notFound("Result");
    const { count } = await tx.crmProspect.updateMany({ where: { id: prospectId, organizationId, companyId, status: "NEW" }, data: { status: "DISMISSED", decidedById: ctx.actor.id ?? null, decidedAt: new Date() } });
    if (!count) throw notFound("Result");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.prospect.dismissed", resourceType: "crm_prospect", resourceId: prospectId });
    return { ok: true };
  });
}
