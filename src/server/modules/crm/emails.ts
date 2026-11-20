import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { can } from "@/server/modules/rbac/service";
import { authorize, isUuid } from "./common";

/**
 * Unified, read-only email history of a lead, contact, account or deal, newest first. Sources:
 * - CRM email activities (CrmActivity EMAIL on the record; LeadActivity EMAIL — incl. send_lead_email — for leads),
 * - proposal emails accepted by the provider (CrmProposalSend),
 * - marketing email sends to the record's addresses (MarketingEmailSend, status SENT; needs marketing.read),
 * - comms inbox messages from/to those addresses or threads linked to the contact (CommsEmailMessage; needs
 *   communication.read).
 */

export type EmailSubject = "lead" | "contact" | "account" | "deal";
export type EmailSource = "crm" | "proposal" | "marketing" | "inbox";

export interface EmailItem {
  id: string;
  source: EmailSource;
  direction: "in" | "out";
  subject: string | null;
  snippet: string;
  at: Date;
  address: string | null;
  href: string | null;
  meta?: string | null;
  opens?: number;
  clicks?: number;
}

const PAGE = 20;
const MAX = 500;
const snippet = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 240);

/** Addresses and record ids the timeline matches on. */
async function scopeOf(organizationId: string, companyId: string, type: EmailSubject, id: string) {
  const where = { id, organizationId, companyId };
  const emails = new Set<string>();
  const add = (e: string | null | undefined) => e && emails.add(e.trim().toLowerCase());
  const s = { leadIds: [] as string[], contactIds: [] as string[], accountIds: [] as string[], dealIds: [] as string[] };
  if (type === "lead") {
    const l = await db().lead.findFirst({ where, select: { id: true, email: true, contacts: { select: { id: true, email: true } } } });
    if (!l) throw notFound("Lead");
    add(l.email);
    s.leadIds.push(l.id);
    for (const c of l.contacts) add(c.email);
  } else if (type === "contact") {
    const c = await db().contact.findFirst({ where, select: { id: true, email: true, leadId: true } });
    if (!c) throw notFound("Contact");
    add(c.email);
    s.contactIds.push(c.id);
    if (c.leadId) s.leadIds.push(c.leadId);
  } else if (type === "account") {
    const a = await db().account.findFirst({ where, select: { id: true, email: true, contacts: { where: { archivedAt: null }, select: { id: true, email: true, leadId: true }, take: 200 } } });
    if (!a) throw notFound("Account");
    add(a.email);
    s.accountIds.push(a.id);
    for (const c of a.contacts) {
      add(c.email);
      s.contactIds.push(c.id);
    }
  } else {
    const d = await db().crmDeal.findFirst({ where, select: { id: true, leadId: true, contact: { select: { id: true, email: true } } } });
    if (!d) throw notFound("Deal");
    s.dealIds.push(d.id);
    if (d.contact) {
      add(d.contact.email);
      s.contactIds.push(d.contact.id);
    }
    if (d.leadId) s.leadIds.push(d.leadId);
  }
  return { ...s, emails: [...emails] };
}

export async function emailTimeline(ctx: RequestContext, organizationId: string, companyId: string, type: EmailSubject, id: string, page = 1) {
  const chain = await authorize(ctx, organizationId, companyId, "sales.read");
  if (!isUuid(id)) throw notFound("Record");
  const sc = await scopeOf(organizationId, companyId, type, id);
  const [canMarketing, canInbox] = await Promise.all([can(ctx, "marketing.read", chain), can(ctx, "communication.read", chain)]);
  const take = Math.min(MAX, page * PAGE);
  const base = { organizationId, companyId };
  const none = Promise.resolve([] as never[]);
  const zero = Promise.resolve(0);

  // CRM activities on this record (a deal's own; a contact's/account's own) — plus the converted lead's emails.
  const crmWhere = {
    ...base,
    type: "EMAIL" as const,
    OR: [
      ...(sc.dealIds.length ? [{ dealId: { in: sc.dealIds } }] : []),
      ...(type === "contact" || type === "account" ? [{ contactId: { in: sc.contactIds } }] : []),
      ...(sc.accountIds.length ? [{ accountId: { in: sc.accountIds } }] : []),
    ],
  };
  const leadWhere = { ...base, type: "EMAIL" as const, leadId: { in: sc.leadIds } };
  const proposalWhere = {
    ...base,
    proposal: {
      OR: [
        ...(sc.dealIds.length ? [{ dealId: { in: sc.dealIds } }] : []),
        ...(sc.contactIds.length ? [{ contactId: { in: sc.contactIds } }] : []),
        ...(sc.accountIds.length ? [{ accountId: { in: sc.accountIds } }] : []),
      ],
    },
  };
  const proposalByAddress = sc.emails.length ? [{ ...base, toEmail: { in: sc.emails, mode: "insensitive" as const } }] : [];
  const marketingWhere = { ...base, status: "SENT" as const, emailNormalized: { in: sc.emails } };
  const inboxWhere = {
    companyId,
    thread: { organizationId },
    OR: [
      ...(sc.emails.length ? [{ fromAddress: { in: sc.emails, mode: "insensitive" as const } }, { toAddresses: { hasSome: sc.emails } }, { ccAddresses: { hasSome: sc.emails } }] : []),
      ...(sc.contactIds.length ? [{ thread: { contactId: { in: sc.contactIds } } }] : []),
    ],
  };
  const useCrm = crmWhere.OR.length > 0;
  const useLead = sc.leadIds.length > 0;
  const useProposal = proposalWhere.proposal.OR.length > 0 || proposalByAddress.length > 0;
  const proposalFilter = { OR: [...(proposalWhere.proposal.OR.length ? [proposalWhere] : []), ...proposalByAddress] };
  const useMarketing = canMarketing && sc.emails.length > 0;
  const useInbox = canInbox && inboxWhere.OR.length > 0;

  const [crm, crmN, leadActs, leadN, sends, sendN, mkt, mktN, inbox, inboxN] = await Promise.all([
    useCrm ? db().crmActivity.findMany({ where: crmWhere, orderBy: { occurredAt: "desc" }, take, select: { id: true, subject: true, summary: true, occurredAt: true, dealId: true, contactId: true, accountId: true } }) : none,
    useCrm ? db().crmActivity.count({ where: crmWhere }) : zero,
    useLead ? db().leadActivity.findMany({ where: leadWhere, orderBy: { occurredAt: "desc" }, take, select: { id: true, summary: true, occurredAt: true, leadId: true } }) : none,
    useLead ? db().leadActivity.count({ where: leadWhere }) : zero,
    useProposal ? db().crmProposalSend.findMany({ where: proposalFilter, orderBy: { sentAt: "desc" }, take, select: { id: true, subject: true, body: true, sentAt: true, toEmail: true, version: true, proposalId: true, proposal: { select: { number: true } } } }) : none,
    useProposal ? db().crmProposalSend.count({ where: proposalFilter }) : zero,
    useMarketing
      ? db().marketingEmailSend.findMany({
          where: marketingWhere,
          orderBy: { createdAt: "desc" },
          take,
          select: { id: true, email: true, createdAt: true, openCount: true, clickCount: true, stepId: true, emailCampaignId: true, enrollmentId: true, emailCampaign: { select: { id: true, name: true, subject: true, body: true } }, enrollment: { select: { sequenceId: true } } },
        })
      : none,
    useMarketing ? db().marketingEmailSend.count({ where: marketingWhere }) : zero,
    useInbox ? db().commsEmailMessage.findMany({ where: inboxWhere, orderBy: { sentAt: "desc" }, take, select: { id: true, threadId: true, direction: true, status: true, fromAddress: true, toAddresses: true, subject: true, bodyText: true, sentAt: true } }) : none,
    useInbox ? db().commsEmailMessage.count({ where: inboxWhere }) : zero,
  ]);

  // Sequence step subjects (MarketingEmailSend has no relation to the step).
  const stepIds = [...new Set(mkt.map((m) => m.stepId).filter((x): x is string => !!x))];
  const steps = stepIds.length ? await db().marketingSequenceStep.findMany({ where: { id: { in: stepIds }, companyId }, select: { id: true, subject: true, body: true } }) : [];
  const stepBy = new Map(steps.map((s) => [s.id, s]));

  const items: EmailItem[] = [
    ...crm.map((a) => ({
      id: `crm:${a.id}`,
      source: "crm" as const,
      direction: "out" as const,
      subject: a.subject,
      snippet: snippet(a.summary),
      at: a.occurredAt,
      address: null,
      href: a.dealId ? `/crm/deals/${a.dealId}` : a.contactId ? `/crm/contacts/${a.contactId}` : a.accountId ? `/crm/accounts/${a.accountId}` : null,
    })),
    ...leadActs.map((a) => {
      const sent = a.summary.match(/^Sent: (.+)\n\n([\s\S]*)$/);
      return { id: `lead:${a.id}`, source: "crm" as const, direction: "out" as const, subject: sent ? sent[1]! : null, snippet: snippet(sent ? sent[2]! : a.summary), at: a.occurredAt, address: null, href: `/crm/${a.leadId}` };
    }),
    ...sends.map((s) => ({ id: `proposal:${s.id}`, source: "proposal" as const, direction: "out" as const, subject: s.subject, snippet: snippet(s.body), at: s.sentAt, address: s.toEmail, href: `/crm/proposals/${s.proposalId}`, meta: `${s.proposal.number} v${s.version}` })),
    ...mkt.map((m) => {
      const step = m.stepId ? stepBy.get(m.stepId) : undefined;
      return {
        id: `marketing:${m.id}`,
        source: "marketing" as const,
        direction: "out" as const,
        subject: m.emailCampaign?.subject ?? step?.subject ?? null,
        snippet: snippet(m.emailCampaign?.body ?? step?.body ?? ""),
        at: m.createdAt,
        address: m.email,
        href: m.emailCampaign ? `/marketing/email/${m.emailCampaign.id}` : m.enrollment ? `/marketing/automation/${m.enrollment.sequenceId}` : null,
        meta: m.emailCampaign?.name ?? null,
        opens: m.openCount,
        clicks: m.clickCount,
      };
    }),
    ...inbox.map((m) => ({
      id: `inbox:${m.id}`,
      source: "inbox" as const,
      direction: m.direction === "INBOUND" ? ("in" as const) : ("out" as const),
      subject: m.subject,
      snippet: snippet(m.bodyText),
      at: m.sentAt,
      address: m.direction === "INBOUND" ? m.fromAddress : (m.toAddresses[0] ?? null),
      href: `/communication/inbox/${m.threadId}`,
      meta: m.status === "SENT" || m.status === "RECEIVED" ? null : m.status,
    })),
  ];
  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  const total = crmN + leadN + sendN + mktN + inboxN;
  return {
    items: items.slice((page - 1) * PAGE, page * PAGE),
    total: Math.min(total, MAX),
    page,
    pageSize: PAGE,
    addresses: sc.emails,
    hidden: { marketing: !canMarketing, inbox: !canInbox },
  };
}
