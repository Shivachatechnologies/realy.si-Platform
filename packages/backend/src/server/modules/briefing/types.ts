/**
 * Shape of a briefing (BriefingReport.data). Pure types — safe to import (as types) from client components.
 * Every number is computed from the company's records; `null` means the recipient may not see that source.
 */

export type BriefingKindKey = "MORNING" | "EVENING" | "WEEKLY" | "TEST";

export interface BriefingMetric {
  key: string;
  labelKey: string;
  unit: "count" | "money" | "percent" | "days" | "hours" | "ratio" | string;
  value: number | null;
  previous: number | null;
  changePct: number | null;
  trend: -1 | 0 | 1;
  href: string | null;
}

export interface BriefingApprovalItem {
  /** Number used in WhatsApp replies ("approve 3"). */
  ref: number;
  id: string;
  summary: string;
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | string;
  expiresAt: string;
  profile: string | null;
  /** Needs a fresh two-factor sign-in (cannot be decided by WhatsApp reply). */
  needsMfa: boolean;
}

export interface BriefingInsight {
  severity: "critical" | "warning" | "info";
  kind: string;
  params: Record<string, string | number>;
  href: string | null;
  department: string | null;
}

export type DecisionKind = "decide_high_risk" | "approvals_expiring" | "fix_insight" | "retry_failed" | "runway" | "chase_receivables" | "review_pending";

export interface BriefingDecision {
  kind: DecisionKind;
  params: Record<string, string | number>;
  /** For fix_insight: the insight to translate. */
  insight?: BriefingInsight;
  href: string;
}

export interface BriefingData {
  v: 1;
  kind: BriefingKindKey;
  generatedAt: string;
  currency: string;
  timezone: string;
  period: { from: string; to: string; days: number };
  workforce: {
    completed: number;
    failed: number;
    inProgress: number;
    /** Approved actions that ran without a person deciding (autonomy grants / policies). */
    autoExecuted: number;
    approvedByPeople: number;
    rejected: number;
    byDepartment: { department: string; completed: number; failed: number }[];
    highlights: { id: string; title: string; department: string | null; employee: string | null }[];
  } | null;
  output: {
    outreachEmails: number | null;
    campaignEmails: number | null;
    postsPublished: number | null;
    calls: number | null;
    meetingsHeld: number | null;
    dealsWon: { count: number; amountMinor: number } | null;
    newLeads: number | null;
  };
  kpis: BriefingMetric[];
  problems: {
    failedTasks: { id: string; title: string; error: string | null }[];
    failedTaskCount: number | null;
    failedApprovals: number | null;
    failedSends: number | null;
    failedPosts: number | null;
    overdueTasks: number | null;
    slaBreaches: number | null;
  };
  approvals: { pending: number; items: BriefingApprovalItem[] } | null;
  today: {
    meetings: { title: string; startsAt: string; kind: "sales" | "team" }[];
    scheduledPosts: number | null;
    campaigns: { name: string; scheduledAt: string }[];
    sequenceSteps: number | null;
    aiSchedules: { name: string; timeOfDay: string | null }[];
    dueTasks: number | null;
    plansRunning: number | null;
  };
  insights: { healthScore: number | null; items: BriefingInsight[] } | null;
  decisions: BriefingDecision[];
}

export const RISK_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
