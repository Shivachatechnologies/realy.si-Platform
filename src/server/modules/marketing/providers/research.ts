// Uses integrations services when available (webSearch) — thin adapter until the lead consolidates.
import type { ProviderConnection } from "../connections-bridge";
import { getMarketingConnection, isUsable } from "../connections-bridge";
import { bearer, call, str } from "./http";

export const RESEARCH_PROVIDERS = ["tavily", "exa", "serpapi"] as const;
export type ResearchProvider = (typeof RESEARCH_PROVIDERS)[number];

export interface ResearchResult {
  provider: ResearchProvider;
  answer: string | null;
  sources: { title: string; url: string; snippet: string }[];
}

type Conn = ProviderConnection & { accessToken: string };

async function tavily(c: Conn, query: string, n: number): Promise<ResearchResult> {
  const res = await call("https://api.tavily.com/search", {
    method: "POST",
    headers: bearer(c.accessToken, { "content-type": "application/json" }),
    body: JSON.stringify({ query, max_results: n, search_depth: "basic", include_answer: true, topic: "general" }),
  });
  const results = Array.isArray(res.json.results) ? (res.json.results as Record<string, unknown>[]) : [];
  return { provider: "tavily", answer: str(res.json.answer), sources: results.map((r) => ({ title: String(r.title ?? ""), url: String(r.url ?? ""), snippet: String(r.content ?? "").slice(0, 600) })) };
}

async function exa(c: Conn, query: string, n: number): Promise<ResearchResult> {
  const res = await call("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": c.accessToken, "content-type": "application/json" },
    body: JSON.stringify({ query, numResults: n, contents: { text: { maxCharacters: 600 } } }),
  });
  const results = Array.isArray(res.json.results) ? (res.json.results as Record<string, unknown>[]) : [];
  return { provider: "exa", answer: null, sources: results.map((r) => ({ title: String(r.title ?? ""), url: String(r.url ?? ""), snippet: String(r.text ?? "").slice(0, 600) })) };
}

async function serpapi(c: Conn, query: string, n: number): Promise<ResearchResult> {
  const res = await call(`https://serpapi.com/search.json?${new URLSearchParams({ engine: "google", q: query, num: String(n), api_key: c.accessToken })}`);
  const results = Array.isArray(res.json.organic_results) ? (res.json.organic_results as Record<string, unknown>[]) : [];
  const box = res.json.answer_box as { answer?: string; snippet?: string } | undefined;
  return { provider: "serpapi", answer: box?.answer ?? box?.snippet ?? null, sources: results.slice(0, n).map((r) => ({ title: String(r.title ?? ""), url: String(r.link ?? ""), snippet: String(r.snippet ?? "").slice(0, 600) })) };
}

/** First connected research provider for the company, or null. */
export async function researchConnection(organizationId: string, companyId: string): Promise<{ provider: ResearchProvider; conn: Conn } | null> {
  for (const provider of RESEARCH_PROVIDERS) {
    const conn = await getMarketingConnection(organizationId, companyId, provider);
    if (isUsable(conn)) return { provider, conn };
  }
  return null;
}

/** Web research through the company's research provider. Returns null when none is connected. */
export async function webSearch(organizationId: string, companyId: string, query: string, n = 6): Promise<ResearchResult | null> {
  const r = await researchConnection(organizationId, companyId);
  if (!r) return null;
  const q = query.slice(0, 400);
  if (r.provider === "tavily") return tavily(r.conn, q, n);
  if (r.provider === "exa") return exa(r.conn, q, n);
  return serpapi(r.conn, q, n);
}

export function researchDigest(r: ResearchResult): string {
  return [r.answer ? `Summary: ${r.answer}` : null, ...r.sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}\n${s.snippet}`)].filter(Boolean).join("\n\n").slice(0, 6000);
}
