import type { Translate } from "@/i18n/translate";

/** What kind of action a request is — drives the preview's icon, colour and layout. */
export type ActionKind = "email" | "lead" | "money" | "post" | "task" | "content" | "people" | "memory" | "generic";

export interface ActionPreview {
  kind: ActionKind;
  /** One plain sentence: "Send this email to Ana Novak". */
  sentence: string;
  /** Exactly what will be sent / created (labelled facts). */
  facts: { label: string; value: string }[];
  /** Message preview (emails, replies, posts, job ads). */
  message?: { to?: string; subject?: string; body: string };
  /** Headline amount for money actions. */
  amount?: string;
  /** Invoice-like line items. */
  lines?: { description: string; quantity: number; unitPrice: string; total: string }[];
}

export interface DescribeContext {
  t: Translate;
  locale: string;
  currency: string;
  timeZone: string;
  /** CRM leads named in requests (id → name / email). */
  leads?: Map<string, { name: string; email: string | null }>;
}

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "");
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

function money(amount: string | number, c: DescribeContext) {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  try {
    return new Intl.NumberFormat(c.locale, { style: "currency", currency: c.currency }).format(n);
  } catch {
    return `${n} ${c.currency}`;
  }
}

function when(v: string, c: DescribeContext) {
  const d = new Date(v.length === 10 ? `${v}T12:00:00Z` : v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat(c.locale, v.length === 10 ? { dateStyle: "medium", timeZone: "UTC" } : { dateStyle: "medium", timeStyle: "short", timeZone: c.timeZone }).format(d);
}

/** Label of an input field: decisionInbox.fields.<key>, else the key in plain words. */
function fieldLabel(t: Translate, key: string) {
  const k = `decisionInbox.fields.${key}`;
  const s = t(k);
  return s === k ? key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^\w/, (m) => m.toUpperCase()) : s;
}

/** Remaining simple inputs as facts (ids and long texts left out — they are shown elsewhere or mean nothing to people). */
function restFacts(c: DescribeContext, input: Record<string, unknown>, skip: string[]) {
  const out: { label: string; value: string }[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (skip.includes(k) || v === null || v === undefined || v === "") continue;
    if (Array.isArray(v)) {
      const items = v.filter((x) => typeof x === "string" && !isUuid(x)) as string[];
      if (items.length) out.push({ label: fieldLabel(c.t, k), value: items.join(", ") });
      continue;
    }
    const s = str(v);
    if (!s || isUuid(s)) continue;
    const value = /date|At$/i.test(k) && /^\d{4}-\d{2}-\d{2}/.test(s) ? when(s, c) : typeof v === "boolean" ? c.t(v ? "common.yes" : "common.no") : s;
    out.push({ label: fieldLabel(c.t, k), value: value.length > 300 ? `${value.slice(0, 300)}…` : value });
  }
  return out;
}

/**
 * Turn a stored AI action (tool + validated input) into a plain-language preview of exactly what will happen.
 * Unknown tools fall back to the tool's own one-line summary plus its simple inputs.
 */
export function describeAction(tool: string, rawInput: unknown, summary: string, c: DescribeContext): ActionPreview {
  const { t } = c;
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
  const s = (k: string) => str(input[k]);
  const a = (key: string, vars?: Record<string, string | number>) => t(`decisionInbox.actions.${key}`, vars);

  switch (tool) {
    case "send_lead_email": {
      const lead = c.leads?.get(s("leadId"));
      const to = lead ? (lead.email ? `${lead.name} <${lead.email}>` : lead.name) : t("decisionInbox.aLead");
      return { kind: "email", sentence: a("send_lead_email", { to: lead?.name ?? t("decisionInbox.aLead") }), facts: [], message: { to, subject: s("subject"), body: s("body") } };
    }
    case "send_email_reply":
      return { kind: "email", sentence: a("send_email_reply"), facts: [], message: { body: s("body") } };
    case "send_ticket_reply":
      return { kind: "email", sentence: a("send_ticket_reply"), facts: [], message: { body: s("body") } };
    case "draft_ticket_reply":
      return { kind: "content", sentence: a("draft_ticket_reply"), facts: [], message: { body: s("body") } };
    case "send_influencer_outreach":
      return { kind: "email", sentence: a("send_influencer_outreach"), facts: [] };
    case "create_lead":
      return { kind: "lead", sentence: a("create_lead", { name: s("name") }), facts: restFacts(c, input, ["name"]) };
    case "create_follow_up":
      return { kind: "task", sentence: a("create_follow_up", { date: when(s("dueDate"), c) }), facts: restFacts(c, input, ["dueDate", "subjectType"]) };
    case "create_work_task":
      return { kind: "task", sentence: a("create_work_task", { title: s("title") }), facts: restFacts(c, input, ["title"]) };
    case "create_project":
      return { kind: "task", sentence: a("create_project", { name: s("name") }), facts: [] };
    case "create_milestone":
      return { kind: "task", sentence: a("create_milestone", { title: s("title") || summary }), facts: restFacts(c, input, ["title"]) };
    case "assign_task":
      return { kind: "task", sentence: a(s("assigneeId") ? "assign_task" : "unassign_task"), facts: [] };
    case "update_task_status":
      return { kind: "task", sentence: a("update_task_status"), facts: restFacts(c, input, []) };
    case "update_deal_stage":
      return { kind: "money", sentence: s("outcome") === "won" ? a("deal_won") : s("outcome") === "lost" ? a("deal_lost") : a("deal_stage"), facts: restFacts(c, input, ["outcome"]) };
    case "create_invoice_draft": {
      const lines = (Array.isArray(input.lines) ? input.lines : []) as { description?: string; quantity?: number; unitPrice?: string }[];
      const rows = lines.map((l) => {
        const q = Number(l.quantity ?? 0);
        const p = Number(l.unitPrice ?? 0);
        return { description: str(l.description), quantity: q, unitPrice: money(p, c), total: money(q * p, c), raw: q * p };
      });
      const total = money(rows.reduce((x, r) => x + r.raw, 0), c);
      return {
        kind: "money",
        sentence: a("create_invoice_draft", { customer: s("customerName"), total }),
        amount: total,
        lines: rows.map((r) => ({ description: r.description, quantity: r.quantity, unitPrice: r.unitPrice, total: r.total })),
        facts: restFacts(c, input, ["customerName", "lines"]),
      };
    }
    case "record_expense":
      return { kind: "money", sentence: a("record_expense", { amount: money(s("amount"), c) }), amount: money(s("amount"), c), facts: restFacts(c, input, ["amount"]) };
    case "set_ad_budget":
      return { kind: "money", sentence: a("set_ad_budget", { amount: money(s("dailyBudget"), c) }), amount: money(s("dailyBudget"), c), facts: [] };
    case "launch_ad_campaign":
      return { kind: "money", sentence: a("launch_ad_campaign"), facts: [] };
    case "set_ad_campaign_status":
      return { kind: "money", sentence: a("set_ad_campaign_status"), facts: restFacts(c, input, []) };
    case "create_campaign":
    case "create_ad_campaign_draft":
      return { kind: "content", sentence: a("create_campaign", { name: s("name") || summary }), amount: s("budget") ? money(s("budget"), c) : undefined, facts: restFacts(c, input, ["name", "budget", "description"]) };
    case "schedule_social_post": {
      const count = Array.isArray(input.accountIds) ? input.accountIds.length : 0;
      return { kind: "post", sentence: a("schedule_social_post", { count, when: when(s("scheduledAt"), c) }), facts: [], message: { subject: s("title"), body: s("text") } };
    }
    case "reply_to_comment":
      return { kind: "post", sentence: a("reply_to_comment"), facts: [], message: { body: s("text") || s("body") || s("message") } };
    case "create_content_draft":
    case "repurpose_content":
    case "generate_creative":
    case "create_product_doc_draft":
      return { kind: "content", sentence: a("create_content_draft", { title: s("title") || summary }), facts: restFacts(c, input, ["title", "body", "content"]), message: s("body") || s("content") ? { body: s("body") || s("content") } : undefined };
    case "create_job_posting":
      return { kind: "people", sentence: a("create_job_posting", { title: s("title") }), facts: restFacts(c, input, ["title", "description"]), message: { body: s("description") } };
    case "score_candidate":
      return { kind: "people", sentence: a("score_candidate"), facts: restFacts(c, input, []) };
    case "remember_company_fact":
      return { kind: "memory", sentence: a("remember_company_fact"), facts: [], message: { body: s("fact") || s("content") || s("text") || summary } };
    default:
      return { kind: "generic", sentence: summary, facts: restFacts(c, input, []) };
  }
}
