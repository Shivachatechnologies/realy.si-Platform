import { z } from "zod";
import { db } from "@/server/core/db";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { listIntegrations, listSyncRuns } from "./service";

/** AI tools of the integrations module, registered in src/server/modules/tools/modules.ts. Use `def` from tools/define. */
export const INTEGRATIONS_TOOLS: Record<string, ToolDefinition> = {
  read_integrations: def({
    name: "read_integrations",
    version: 1,
    description: "Lists the company's integrations (Google, Microsoft, Slack, Stripe, HubSpot, Salesforce, social, accounting, webhooks...) with their connection status, connected account and last sync. Never returns credentials.",
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
          `- ${i.info.key} (${i.info.name}, ${i.info.category}): ${i.status ?? "not connected"}${i.connection?.externalAccount ? `, account ${i.connection.externalAccount}` : ""}${i.connection?.lastSyncAt ? `, last sync ${i.connection.lastSyncAt.toISOString()}` : ""}${i.connection?.lastError ? `, error: ${i.connection.lastError}` : ""}${i.info.authType === "oauth2" && !i.configured ? " (OAuth app not configured by the platform admin)" : ""}`,
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
};
