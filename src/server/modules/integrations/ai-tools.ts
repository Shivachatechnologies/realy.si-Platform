import { z } from "zod";
import { db } from "@/server/core/db";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { listIntegrations, listSyncRuns } from "./service";
import { webSearch } from "./services/research";

const activeName = (config: unknown): string | null => {
  const c = (config && typeof config === "object" ? config : {}) as { accounts?: { id: string; name: string }[]; activeAccountId?: string };
  return c.accounts?.find((a) => a.id === c.activeAccountId)?.name ?? null;
};

/** AI tools of the integrations module, registered in src/server/modules/tools/modules.ts. Use `def` from tools/define. */
export const INTEGRATIONS_TOOLS: Record<string, ToolDefinition> = {
  read_integrations: def({
    name: "read_integrations",
    version: 1,
    description: "Lists the company's integrations (AI, research, creative, social, ads, search, CMS, email, messaging, payments, storage, CRM, accounting, productivity, webhooks) with their connection status, connected account, active sub-account, health and last sync. Never returns credentials.",
    input: z.object({}).strict(),
    modelSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    permissions: ["integrations.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read integrations",
    async execute(_input, { ctx, organizationId, companyId }) {
      const list = await listIntegrations(ctx, organizationId, companyId);
      const hooks = await db().integrationHook.findMany({ where: { organizationId, companyId, active: true }, select: { id: true, name: true } });
      const lines = list.map(
        (i) =>
          `- ${i.info.key} (${i.info.name}, ${i.info.category}): ${i.status ?? "not connected"}${i.connection?.externalAccount ? `, account ${i.connection.externalAccount}` : ""}${activeName(i.connection?.config) ? `, active ${activeName(i.connection?.config)}` : ""}${i.connection?.errorStreak ? `, ${i.connection.errorStreak} failed calls in a row` : ""}${i.connection?.lastSyncAt ? `, last sync ${i.connection.lastSyncAt.toISOString()}` : ""}${i.connection?.lastError ? `, error: ${i.connection.lastError}` : ""}${i.info.authType === "oauth2" && !i.configured ? " (OAuth app not configured by the platform admin)" : ""}`,
      );
      const hookLines = hooks.map((h) => `- incoming webhook "${h.name}" id ${h.id}`);
      return { content: `Integrations:\n${lines.join("\n")}\n\nIncoming webhooks:\n${hookLines.length ? hookLines.join("\n") : "(none)"}`, count: list.length };
    },
  }),
  read_sync_runs: def({
    name: "read_sync_runs",
    version: 1,
    description: "Lists recent integration sync runs (provider, kind, status, items read/created/updated, errors), newest first.",
    input: z.object({ provider: z.string().max(40).optional(), status: z.enum(["SUCCEEDED", "PARTIAL", "FAILED"]).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { provider: { type: "string", description: "Provider key, e.g. stripe, hubspot" }, status: { type: "string", enum: ["SUCCEEDED", "PARTIAL", "FAILED"] } },
      required: [],
      additionalProperties: false,
    },
    permissions: ["integrations.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ provider }) => `Read sync runs${provider ? ` for ${provider}` : ""}`,
    async execute({ provider, status }, { ctx, organizationId, companyId }) {
      const { data } = await listSyncRuns(ctx, organizationId, companyId, { provider, status, limit: 30 });
      if (!data.length) return { content: "No sync runs.", count: 0 };
      const lines = data.map((r) => `- ${r.startedAt.toISOString()} ${r.provider} ${r.kind} ${r.status}: read ${r.itemsRead}, created ${r.itemsCreated}, updated ${r.itemsUpdated}, errors ${r.errorCount}${r.errorCount ? ` (${JSON.stringify(r.errors).slice(0, 300)})` : ""}`);
      return { content: lines.join("\n"), count: data.length, records: data.map((r) => `integration_sync_run:${r.id}`) };
    },
  }),
  web_research: def({
    name: "web_research",
    version: 1,
    description:
      "Searches the public web through the company's connected research provider (Tavily, then Exa, then SerpApi as fallbacks) and returns titles, URLs, snippets and dates. Use for market, competitor, news or fact research; cite the URLs. Fails truthfully when no research provider is connected.",
    input: z.object({ query: z.string().trim().min(2).max(400), maxResults: z.number().int().min(1).max(10).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search query" }, maxResults: { type: "integer", minimum: 1, maximum: 10, description: "Default 5" } },
      required: ["query"],
      additionalProperties: false,
    },
    permissions: ["brain.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 45_000,
    summarize: ({ query }) => `Web research: ${query}`,
    async execute({ query, maxResults }, { organizationId, companyId }) {
      const r = await webSearch(organizationId, companyId, query, { maxResults: maxResults ?? 5 });
      if (!r.ok) return { content: `Web research unavailable: ${r.error}${r.code === "not_connected" ? " (a manager can connect Tavily, Exa or SerpApi under Integrations)" : ""}`, count: 0 };
      if (!r.data.results.length) return { content: `No web results for "${query}" (via ${r.providerId}).`, count: 0 };
      const lines = r.data.results.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}${x.publishedAt ? ` (${x.publishedAt})` : ""}\n   ${x.snippet}`);
      return { content: `Web results for "${query}" via ${r.providerId}:\n${lines.join("\n")}`, count: r.data.results.length };
    },
  }),
};
