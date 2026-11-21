// Web research for marketing goes through the Integrations research service (Tavily → Exa → SerpApi with fallback,
// request log, rate limits and usage/cost records). This file only adapts the result shape for marketing prompts.
import { RESEARCH_PROVIDERS, webSearch as integrationsWebSearch } from "@/server/modules/integrations/services/research";

export { RESEARCH_PROVIDERS };
export type ResearchProvider = (typeof RESEARCH_PROVIDERS)[number];

export interface ResearchResult {
  provider: string;
  answer: string | null;
  sources: { title: string; url: string; snippet: string }[];
}

/** Web research through the company's research providers. Returns null when none is connected or all failed. */
export async function webSearch(organizationId: string, companyId: string, query: string, n = 6): Promise<ResearchResult | null> {
  const r = await integrationsWebSearch(organizationId, companyId, query, { maxResults: n });
  if (!r.ok) return null;
  return { provider: r.providerId, answer: null, sources: r.data.results.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet })) };
}

export function researchDigest(r: ResearchResult): string {
  return [r.answer ? `Summary: ${r.answer}` : null, ...r.sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}\n${s.snippet}`)].filter(Boolean).join("\n\n").slice(0, 6000);
}
