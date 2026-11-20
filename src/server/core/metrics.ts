/**
 * Cross-module KPI contract. Each business module declares its metrics in src/server/modules/<module>/metrics.ts;
 * the analytics module (bi) builds dashboards, widgets, comparisons and AI briefings on top of them.
 */
export type MetricUnit = "count" | "money" | "percent" | "days" | "hours";

export interface MetricRange {
  from: Date;
  /** Exclusive. */
  to: Date;
}

export interface MetricScope {
  organizationId: string;
  companyId: string;
  /** Company base currency, for money metrics. */
  currency: string;
}

export interface MetricDefinition {
  /** Globally unique, "<module>.<name>", e.g. "finance.revenue". */
  key: string;
  /** i18n key for the label, e.g. "finance.metrics.revenue". */
  labelKey: string;
  department: "executive" | "sales" | "marketing" | "finance" | "hr" | "projects" | "support" | "operations" | "ai";
  unit: MetricUnit;
  /** Permission required to see it (checked at the company by the analytics module). */
  permission: string;
  /** "flow" metrics sum over the range (revenue); "stock" metrics are a value at range end (open deals, headcount). */
  kind: "flow" | "stock";
  /** Higher is better (for trend colouring). */
  higherIsBetter?: boolean;
  /** Value for the range. Money in minor units of scope.currency. */
  compute(scope: MetricScope, range: MetricRange): Promise<number | bigint>;
  /** In-app drilldown path after /{locale}. */
  href?: string;
}
