import { z } from "zod";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { costOverview } from "./service";

const usd = (micros: string | number) => `$${(Number(micros) / 1_000_000).toFixed(2)}`;

/** Cost tools (register in tools/modules.ts). Read-only: the ledger as recorded, never estimates presented as invoices. */
export const COSTS_TOOLS: Record<string, ToolDefinition> = {
  read_spending: def({
    name: "read_spending",
    version: 1,
    description:
      "Returns the company's recorded spend (AI tokens, images, video, voice, telephony, messaging, external APIs) this month and over the last N days: totals, run-rate forecast, by department / AI employee / provider / model, and budgets with how much is used.",
    input: z.object({ days: z.number().int().min(7).max(90).optional() }).strict(),
    modelSchema: { type: "object", properties: { days: { type: "integer", description: "Look-back window in days (7-90, default 30)" } }, required: [], additionalProperties: false },
    permissions: ["agents.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    actionClass: "read",
    summarize: ({ days }) => `Read spending for the last ${days ?? 30} days`,
    async execute({ days }, { ctx, organizationId, companyId }) {
      const o = await costOverview(ctx, organizationId, companyId, { days });
      if (!o.totals.entries && o.totals.monthMicros === "0") return { content: "No spend has been recorded for this company yet.", count: 0 };
      const top = (rows: { key?: string; name?: string; micros: string }[]) =>
        rows
          .slice(0, 6)
          .map((r) => `${r.name ?? r.key}: ${usd(r.micros)}`)
          .join("; ") || "none";
      const lines = [
        `Month to date: ${usd(o.totals.monthMicros)} (today ${usd(o.totals.todayMicros)}). Run-rate forecast for the month: ${usd(o.totals.projectedMonthMicros)}.`,
        `Last ${o.days} days: ${usd(o.totals.rangeMicros)} across ${o.totals.entries} recorded spends. Prompt-cache hit rate ${o.totals.cacheHitPct}%.`,
        `By department: ${top(o.byDepartment)}.`,
        `By AI employee: ${top(o.byAgent)}.`,
        `By provider: ${top(o.byProvider)}.`,
        `By model: ${top(o.byModel)}.`,
        o.budgets.length
          ? `Budgets: ${o.budgets.map((b) => `${b.scope.toLowerCase()} ${b.label}: ${usd(b.spentMicros)} of ${usd(b.limitMicros)} (${b.pct}%${b.hardStop ? ", hard stop" : ""})`).join("; ")}.`
          : "No budgets are set.",
      ];
      return { content: lines.join("\n"), count: o.totals.entries };
    },
  }),
};
