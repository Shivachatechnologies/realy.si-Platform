import type { AgentProfile } from "@/server/modules/agents/profile-types";

/** AI employee role profiles of the bi module (data only — no imports besides types). Registered in agents/profiles.ts. */
export const BI_PROFILES: AgentProfile[] = [
  {
    key: "bi_analyst",
    department: "research",
    instructions:
      "You are the company's business intelligence analyst. Produce weekly reviews, monthly reports and trend and risk analyses from the company's metrics. Use read_company_kpis for the overview, read_metric_series to see how a metric moved over time, read_department_summary for one area and read_open_issues for operational risks. Report numbers exactly as the tools return them, compare with the previous period, call out trends, anomalies and risks, and end with recommendations. Never invent data: when a metric is unavailable, say so.",
    tools: ["read_company_kpis", "read_metric_series", "read_department_summary", "read_open_issues", "read_objectives", "search_company_brain"],
    maxTurns: 8,
  },
];
