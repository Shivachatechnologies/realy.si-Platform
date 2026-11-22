import { db } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { systemContext } from "@/server/core/context";
import { departmentManager, runManagerTask } from "@/server/modules/cockpit/department-manager";
import { evaluateAutonomy } from "@/server/modules/workforce/autonomy-policy";

/**
 * Support automation run by the hired support AI employee (support_agent / support_lead):
 * - first response: every new ticket gets a researched reply proposed with send_ticket_reply. That tool is SUPERVISED
 *   and HIGH risk, so the reply waits for a person's approval in the approvals inbox (the gateway's autonomy policy
 *   decides; nothing is reported as sent before it is). When the company's autonomy policy puts the support
 *   department's external replies (send_message / email) on Auto, the reply is sent directly through the gateway's
 *   autonomous path (limits reserved, recorded in the auto-approved log with undo/feedback). Tickets already answered
 *   are skipped.
 * - triage: category, priority and tags proposed with triage_ticket (approved by a person).
 * - SLA breach escalation: for HIGH/URGENT breaches the support lead proposes the escalation and drafts a recovery reply.
 * Nothing runs unless the company enabled it in Support settings and hired a support AI employee.
 */

const AGENT_PROFILES = ["support_agent", "support_lead"] as const;

async function alreadyQueued(organizationId: string, companyId: string, ticketId: string, titlePrefix: string) {
  return !!(await db().agentTask.findFirst({ where: { organizationId, companyId, subjectType: "ticket", subjectId: ticketId, title: { startsWith: titlePrefix } }, select: { id: true } }));
}

/** ticket.created handler: first response and/or AI triage for the new ticket. */
export async function handleNewTicket(companyId: string, ticketId: string) {
  const [settings, ticket] = await Promise.all([
    db().supportSettings.findUnique({ where: { companyId }, select: { aiFirstResponseEnabled: true, aiTriageEnabled: true } }),
    db().supportTicket.findFirst({ where: { id: ticketId, companyId }, select: { id: true, organizationId: true, number: true, subject: true, channel: true, firstRespondedAt: true, status: true } }),
  ]);
  if (!settings || !ticket || !settings.aiFirstResponseEnabled) return 0;
  if (ticket.firstRespondedAt || ticket.status === "SOLVED" || ticket.status === "CLOSED") return 0;
  const m = await departmentManager(companyId, AGENT_PROFILES);
  if (!m || m.organizationId !== ticket.organizationId) return 0;
  const prefix = `First response #${ticket.number}`;
  if (await alreadyQueued(ticket.organizationId, companyId, ticket.id, prefix)) return 0;
  // Autonomy (docs/autonomy.md): may the support department email customers on its own right now?
  const autonomy = await evaluateAutonomy(systemContext(), ticket.organizationId, companyId, { department: "support", actionClass: "send_message", channel: ticket.channel === "WHATSAPP" ? "whatsapp" : "email" }).catch(() => null);
  const autoSend = autonomy?.decision === "auto";
  const instructions = [
    `A new support ticket arrived (#${ticket.number}, ticketId ${ticket.id}, channel ${ticket.channel}). Call read_ticket first, then search_kb_articles for the customer's question.`,
    settings.aiTriageEnabled
      ? "Triage it: propose the best category, priority (LOW / NORMAL / HIGH / URGENT) and up to three tags with triage_ticket, each justified by the ticket text."
      : null,
    "Write the first response in the customer's language: acknowledge the issue, answer it from the knowledge base articles when they cover it (name the article), otherwise ask the one or two questions needed to resolve it and say what happens next. Warm, precise, brief; never promise what the articles or policy do not support. Sign as the support team and say the reply was prepared with AI assistance.",
    autoSend
      ? "Send it with send_ticket_reply (ticketId and the reply text): the company's Auto mode lets support replies go out without approval, within its limits. If the ticket needs a human decision (refund, legal, security, angry customer, anything the articles don't cover), do not send: save the reply with draft_ticket_reply and say why a person should handle it."
      : "Propose sending it with send_ticket_reply (ticketId and the reply text). If the ticket needs a human decision (refund, legal, security, angry customer, anything the articles don't cover), do not send: save the reply with draft_ticket_reply and say why a person should handle it.",
    autoSend
      ? "Finish with one line saying what you did. A reply only counts as sent when the tool result says it was delivered (if it says approval was requested, say that instead)."
      : "Finish with one line saying what you proposed. A sent reply only counts once it is approved and delivered.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const id = await runManagerTask(m, "support", { title: `${prefix}: ${ticket.subject}`, instructions, subject: { type: "ticket", id: ticket.id } });
  return id ? 1 : 0;
}

/** After an SLA breach: the support lead proposes how to escalate and drafts a recovery reply (HIGH/URGENT only). */
export async function escalateBreaches(tickets: { id: string; organizationId: string; companyId: string; number: number; subject: string; priority: string; triggers: string[] }[]) {
  let queued = 0;
  const enabled = new Map<string, boolean>();
  for (const t of tickets) {
    if (t.priority !== "HIGH" && t.priority !== "URGENT") continue;
    try {
      if (!enabled.has(t.companyId)) enabled.set(t.companyId, !!(await db().supportSettings.findUnique({ where: { companyId: t.companyId }, select: { aiSlaEscalationEnabled: true } }))?.aiSlaEscalationEnabled);
      if (!enabled.get(t.companyId)) continue;
      const m = await departmentManager(t.companyId, ["support_lead", "support_agent"]);
      if (!m) continue;
      const prefix = `SLA escalation #${t.number}`;
      if (await alreadyQueued(t.organizationId, t.companyId, t.id, `${prefix} ${t.triggers.join(",")}`)) continue;
      const id = await runManagerTask(m, "support", {
        title: `${prefix} ${t.triggers.join(",")}: ${t.subject}`,
        subject: { type: "ticket", id: t.id },
        instructions: `Ticket #${t.number} (ticketId ${t.id}, priority ${t.priority}) breached its SLA (${t.triggers.join(", ").toLowerCase().replace(/_/g, " ")}). Call read_ticket and read_support_queue. Then: (1) say in two lines why it is late (no reply, waiting on us, unassigned, complex), (2) recommend the escalation — who should own it now (from the agents in the queue) and by when, (3) draft a short apology-and-next-step reply for the customer with draft_ticket_reply (internal draft, not sent). Do not send anything to the customer.`,
      });
      if (id) queued++;
    } catch (err) {
      logger.warn({ err, ticketId: t.id }, "SLA AI escalation not queued");
    }
  }
  return queued;
}
