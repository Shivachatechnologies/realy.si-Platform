import type { RequestContext } from "@/server/core/context";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { ingestDocument } from "@/server/modules/brain/service";
import { webSearch, type WebResult } from "@/server/modules/integrations/services/research";
import { parseBrief } from "./brief";

/**
 * Journey "web_research" system step: live web searches through the integrations research service (Tavily → Exa →
 * SerpApi, metered and rate-limited there) about the idea, its market, competitors and customers. The results are saved
 * as one Company Brain document (so the AI research steps cite them with search_company_brain) and every result is
 * recorded as a BuilderSource ("web_result"). Without a connected research provider nothing is searched or recorded
 * and the step is skipped with the reason, which the Intelligence stage shows plainly.
 */

export type WebResearchOutcome =
  | { status: "done"; queries: number; results: number; providerId: string | null; documentId: string | null }
  | { status: "skipped"; reason: "not_connected" | "no_topic" }
  | { status: "failed"; reason: string; message: string };

type RunLike = { id: string; organizationId: string; companyId: string; brief: unknown; company: { name: string } };

/** Up to four search queries from the founder's own words (nothing invented). */
export function researchQueries(raw: unknown, companyName: string): string[] {
  const b = parseBrief(raw);
  const topic = (b.offering || b.idea || b.industry || "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (!topic) return [];
  const where = b.targetMarket?.slice(0, 60) || b.targetMarketCodes.slice(0, 3).join(" ") || b.countryCode || "";
  const subject = b.name || (b.websiteUrl ? companyName : "");
  return [
    `${topic} market size trends ${where}`.trim(),
    `${topic} competitors alternatives ${where}`.trim(),
    `${topic} customers pain points reviews`.trim(),
    subject ? `"${subject}" ${b.industry ?? ""}`.trim() : `${topic} pricing business model`.trim(),
  ];
}

export async function runWebResearch(ctx: RequestContext, run: RunLike): Promise<WebResearchOutcome> {
  const queries = researchQueries(run.brief, run.company.name);
  if (!queries.length) return { status: "skipped", reason: "no_topic" };
  const outcomes = await Promise.all(queries.map((q) => webSearch(run.organizationId, run.companyId, q, { maxResults: 5 })));
  if (outcomes.every((o) => !o.ok && o.code === "not_connected")) return { status: "skipped", reason: "not_connected" };
  const ok = outcomes.flatMap((o) => (o.ok ? [o.data] : []));
  if (!ok.length) {
    const failed = outcomes.find((o) => !o.ok);
    return { status: "failed", reason: failed && !failed.ok ? failed.code : "provider_error", message: failed && !failed.ok ? failed.error : "Web research failed" };
  }
  const seen = new Set<string>();
  const results: (WebResult & { query: string })[] = [];
  for (const o of ok) {
    for (const r of o.results) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      results.push({ ...r, query: o.query });
    }
  }
  const providerId = outcomes.find((o) => o.ok)?.providerId ?? null;
  let documentId: string | null = null;
  if (results.length) {
    const body = ok
      .map((o) => [`## ${o.query}`, ...o.results.map((r) => `- **${r.title || r.url}** — ${r.snippet}${r.publishedAt ? ` (${r.publishedAt})` : ""}\n  Source: ${r.url}`)].join("\n"))
      .join("\n\n");
    try {
      const doc = await ingestDocument(ctx, run.organizationId, run.companyId, {
        title: `${run.company.name} — Web research`.slice(0, 200),
        filename: "web-research.md",
        content: `# Web research (${new Date().toISOString().slice(0, 10)}, via ${providerId ?? "research provider"})\n\nSearch results only — verify before relying on them.\n\n${body}`.slice(0, 900_000),
        tags: ["builder", "research", "web-research"],
      });
      documentId = doc.id;
    } catch (err) {
      if (isAppError(err) && typeof err.details?.documentId === "string") documentId = err.details.documentId;
      else throw err;
    }
    await db().builderSource.createMany({
      data: results.slice(0, 40).map((r) => ({
        organizationId: run.organizationId,
        companyId: run.companyId,
        runId: run.id,
        kind: "web_result",
        url: r.url.slice(0, 2000),
        title: (r.title || r.url).slice(0, 200),
        status: "INGESTED" as const,
        brainDocumentId: documentId,
      })),
    });
  }
  return { status: "done", queries: ok.length, results: results.length, providerId, documentId };
}
