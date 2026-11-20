import type { Translate } from "@/i18n/translate";

/** Tools with their own plain-language step label (guide.trace.tools.<tool>). */
const NAMED = new Set([
  "search_company_brain",
  "read_company_graph",
  "read_objectives",
  "read_company_memory",
  "read_pipeline_summary",
  "read_leads",
  "create_lead",
  "send_lead_email",
  "read_financial_summary",
  "read_invoices",
  "create_invoice_draft",
  "read_campaigns",
  "create_campaign",
  "create_content_draft",
  "read_company_kpis",
  "delegate_to_ai_employee",
  "read_ai_employees",
  "read_open_jobs",
  "create_job_posting",
  "read_projects",
  "create_work_task",
  "read_support_queue",
  "draft_ticket_reply",
  "read_workflows",
]);

/** Kind of step a tool is, for its icon and the generic label. */
export function toolVerb(tool: string): "read" | "search" | "draft" | "change" | "send" | "delegate" | "analyze" | "other" {
  if (tool.startsWith("delegate_")) return "delegate";
  if (tool.startsWith("search_")) return "search";
  if (tool.startsWith("read_")) return "read";
  if (/^(send_|schedule_|publish_)/.test(tool)) return "send";
  if (/^(create_|draft_|record_|remember_)/.test(tool)) return "draft";
  if (/^(update_|assign_|install_)/.test(tool)) return "change";
  if (/^(score_|detect_)/.test(tool)) return "analyze";
  return "other";
}

/** "Searching Company Brain", "Reading CRM pipeline", or "Drafting · Create project" for any other tool. */
export function toolStepLabel(t: Translate, tool: string): string {
  if (NAMED.has(tool)) return t(`guide.trace.tools.${tool}`);
  const nameKey = `workforce.toolNames.${tool}`;
  const name = t(nameKey);
  return t(`guide.trace.verbs.${toolVerb(tool)}`, { name: name === nameKey ? tool.replace(/_/g, " ") : name });
}
