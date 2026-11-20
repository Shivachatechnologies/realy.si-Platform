import { z } from "zod";
import { formatMoney } from "@/i18n/format";
import type { MetricDefinition } from "@/server/core/metrics";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { GROWTH_TOOLS } from "@/server/modules/growth/ai-tools";
import { criticalIssues, issueText } from "./issues";
import { englishT } from "./labels";
import { RANGE_KEYS, isoDay, resolveRange, type RangeKey } from "./range";
import { BI_DEPARTMENTS, metricContext, metricSeries, metricValues } from "./service";

const fmt = (unit: MetricDefinition["unit"], v: number | null, currency: string) => {
  if (v === null) return "unavailable";
  if (unit === "money") return formatMoney({ amountMinor: BigInt(Math.round(v)), currency }, "en-US");
  if (unit === "percent") return `${v.toFixed(1)}%`;
  return `${Number.isInteger(v) ? v : v.toFixed(2)}${unit === "days" ? " days" : unit === "hours" ? " h" : ""}`;
};
const rangeEnum = RANGE_KEYS.filter((k) => k !== "custom") as Exclude<RangeKey, "custom">[];
const rangeSchema = { type: "string", enum: rangeEnum, description: "7d, 30d, 90d, month (to date), quarter (to date) or year (to date). Default 30d." };

async function kpiLines(x: Parameters<ToolDefinition["execute"]>[1], range: RangeKey, department?: string) {
  const { scope, metrics } = await metricContext(x.ctx, x.organizationId, x.companyId);
  const chosen = department ? metrics.filter((m) => m.department === department) : metrics;
  const r = resolveRange(range);
  const values = await metricValues(chosen, scope, r);
  const lines = values.map(
    (v) =>
      `- ${englishT(v.labelKey)} [${v.key}, ${v.department}]: ${fmt(v.unit, v.value, scope.currency)} (previous ${fmt(v.unit, v.previous, scope.currency)}${v.changePct === null ? "" : `, ${v.changePct >= 0 ? "+" : ""}${v.changePct.toFixed(1)}%`}${v.trend === -1 ? ", worse" : v.trend === 1 ? ", better" : ""})`,
  );
  return { lines, period: `${isoDay(r.from)} to ${isoDay(new Date(r.to.getTime() - 1))}`, count: values.length };
}

/** AI tools of the bi module, registered in src/server/modules/tools/modules.ts. */
export const BI_TOOLS: Record<string, ToolDefinition> = {
  ...GROWTH_TOOLS,
  read_company_kpis: def({
    name: "read_company_kpis",
    version: 1,
    description: "Returns every company KPI the requester may see for a period, with the previous period of equal length and the change.",
    input: z.object({ range: z.enum(rangeEnum).optional() }).strict(),
    modelSchema: { type: "object", properties: { range: rangeSchema }, required: [], additionalProperties: false },
    permissions: ["analytics.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 60_000,
    summarize: () => "Read company KPIs",
    async execute({ range }, x) {
      const { lines, period, count } = await kpiLines(x, range ?? "30d");
      return { content: count ? `KPIs for ${period}:\n${lines.join("\n")}` : "No KPIs are available to the requester yet.", count };
    },
  }),

  read_department_summary: def({
    name: "read_department_summary",
    version: 1,
    description: "Returns the KPIs of one department (sales, marketing, finance, hr, projects, support, operations, ai, executive) with the previous period and change.",
    input: z.object({ department: z.enum(BI_DEPARTMENTS), range: z.enum(rangeEnum).optional() }).strict(),
    modelSchema: { type: "object", properties: { department: { type: "string", enum: [...BI_DEPARTMENTS] }, range: rangeSchema }, required: ["department"], additionalProperties: false },
    permissions: ["analytics.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 60_000,
    summarize: ({ department }) => `Read the ${department} summary`,
    async execute({ department, range }, x) {
      const { lines, period, count } = await kpiLines(x, range ?? "30d", department);
      return { content: count ? `${department} KPIs for ${period}:\n${lines.join("\n")}` : `No ${department} KPIs are available to the requester.`, count };
    },
  }),

  read_open_issues: def({
    name: "read_open_issues",
    version: 1,
    description: "Returns open issues computed from the company's data: negative KPI trends, overdue work tasks and follow-ups, metrics that flag problems (overdue invoices, SLA breaches), expiring approvals, failed AI tasks and AI employees over budget.",
    input: z.object({}).strict(),
    modelSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    permissions: ["analytics.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 60_000,
    summarize: () => "Read open issues",
    async execute(_input, { ctx, organizationId, companyId }) {
      const { chain, scope, metrics } = await metricContext(ctx, organizationId, companyId);
      const issues = await criticalIssues(ctx, chain, scope, metrics);
      if (!issues.length) return { content: "No open issues were detected.", count: 0 };
      return { content: issues.map((i) => `- [${i.severity}] ${issueText(i, englishT)}`).join("\n"), count: issues.length };
    },
  }),

  read_metric_series: def({
    name: "read_metric_series",
    version: 1,
    description: "Returns one metric computed for consecutive periods (daily, weekly or monthly buckets) across a range, for trend analysis. Use metric keys from read_company_kpis.",
    input: z.object({ metricKey: z.string().max(100), range: z.enum(rangeEnum).optional() }).strict(),
    modelSchema: { type: "object", properties: { metricKey: { type: "string", description: "Metric key, e.g. finance.revenue" }, range: rangeSchema }, required: ["metricKey"], additionalProperties: false },
    permissions: ["analytics.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 90_000,
    summarize: ({ metricKey }) => `Read the trend of ${metricKey}`,
    async execute({ metricKey, range }, { ctx, organizationId, companyId }) {
      const { scope, metrics } = await metricContext(ctx, organizationId, companyId);
      const m = metrics.find((d) => d.key === metricKey);
      if (!m) return { content: `Metric ${metricKey} does not exist or the requester may not see it.`, count: 0 };
      const series = await metricSeries(m, scope, resolveRange(range ?? "90d"), 24);
      const lines = series.map((p) => `- ${p.from.slice(0, 10)} to ${new Date(new Date(p.to).getTime() - 1).toISOString().slice(0, 10)}: ${fmt(m.unit, p.value, scope.currency)}`);
      return { content: `${englishT(m.labelKey)} (${m.kind === "flow" ? "total per period" : "value at period end"}):\n${lines.join("\n")}`, count: series.length };
    },
  }),
};
