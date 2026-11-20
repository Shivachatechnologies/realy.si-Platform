import "server-only";
import { providerFetch } from "../client";
import { FLAT_COST_MICROS, recordUsage } from "../usage";
import { ensureOk, errorText, str, withFallback, type ServiceResult } from "./common";

/** Web research with provider fallback: Tavily → Exa → SerpApi (skips unconnected, falls back on errors and rate limits). */

export const RESEARCH_PROVIDERS = ["tavily", "exa", "serpapi"] as const;

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
  score: number | null;
}

export interface WebSearchOptions {
  maxResults?: number;
  /** Restrict the provider order (e.g. ["exa"]). */
  providers?: readonly (typeof RESEARCH_PROVIDERS)[number][];
}

const clean = (s: unknown, max = 600) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

export async function webSearch(organizationId: string, companyId: string, query: string, opts: WebSearchOptions = {}): Promise<ServiceResult<{ query: string; results: WebResult[] }>> {
  const q = query.trim().slice(0, 400);
  if (!q) return { ok: false, code: "invalid_input", error: "Query is empty", providerId: null, attempts: [] };
  const max = Math.min(Math.max(1, Math.floor(opts.maxResults ?? 5)), 20);
  return withFallback(organizationId, companyId, opts.providers ?? RESEARCH_PROVIDERS, async (conn) => {
    const meter = (status: "SUCCEEDED" | "FAILED", error?: string) =>
      recordUsage({ organizationId, companyId, connectionId: conn.id, provider: conn.provider, operation: "research.search", status, error, estimatedCostMicros: status === "SUCCEEDED" ? FLAT_COST_MICROS[`${conn.provider}.search`] : 0, meta: { maxResults: max } });
    try {
      let results: WebResult[] = [];
      if (conn.provider === "tavily") {
        const res = await providerFetch<{ results?: Record<string, unknown>[] }>(conn, "https://api.tavily.com/search", { json: { query: q, max_results: max, search_depth: "basic" }, retries: 1 });
        ensureOk(res, "Tavily search");
        results = (res.data?.results ?? []).map((r) => ({ title: clean(r.title, 200), url: String(r.url ?? ""), snippet: clean(r.content), publishedAt: str(r.published_date), score: typeof r.score === "number" ? r.score : null }));
      } else if (conn.provider === "exa") {
        const res = await providerFetch<{ results?: Record<string, unknown>[] }>(conn, "https://api.exa.ai/search", { json: { query: q, numResults: max, contents: { text: { maxCharacters: 600 } } }, retries: 1 });
        ensureOk(res, "Exa search");
        results = (res.data?.results ?? []).map((r) => ({ title: clean(r.title, 200), url: String(r.url ?? ""), snippet: clean(r.text ?? r.summary), publishedAt: str(r.publishedDate), score: typeof r.score === "number" ? r.score : null }));
      } else {
        const url = `https://serpapi.com/search.json?${new URLSearchParams({ engine: "google", q, num: String(max), api_key: conn.accessToken })}`;
        const res = await providerFetch<{ organic_results?: Record<string, unknown>[]; error?: string }>(conn, url, { retries: 1 });
        ensureOk(res, "SerpApi search");
        if (res.data?.error && !/hasn't returned any results/i.test(res.data.error)) throw new Error(`SerpApi: ${res.data.error.slice(0, 160)}`);
        results = (res.data?.organic_results ?? []).slice(0, max).map((r) => ({ title: clean(r.title, 200), url: String(r.link ?? ""), snippet: clean(r.snippet), publishedAt: str(r.date), score: null }));
      }
      await meter("SUCCEEDED");
      return { query: q, results: results.filter((r) => /^https?:\/\//.test(r.url)) };
    } catch (err) {
      await meter("FAILED", errorText(err));
      throw err;
    }
  });
}
