import { z } from "zod";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { getAccount } from "./accounts";
import { addCrmFollowUp, subjectWorkspace } from "./activities";
import { isoDay, toMajor } from "./common";
import { contactName, listContacts } from "./contacts";
import { closeDeal, createDeal, getDeal, listDeals, moveDealStage, parseDealFilters, pipelineBoard } from "./deals";
import { parseSalesRange, salesForecast, salesSummary } from "./sales";
import { addFollowUp } from "./service";
import { transaction } from "@/server/core/db";
import { authorize } from "./common";
import { getProposal, insertProposal, listProposals, parseProposalFilters, proposalInput } from "./proposals";
import { nextActions } from "./next-actions";
import { createOutreachDraft } from "./outreach";
import { enrichLead, latestIntel } from "./intel";
import { enroll } from "./cadences";
import { listAutopilots } from "./prospecting";
import { findPeople, SENIORITIES } from "@/server/modules/integrations/services/contacts";

const money = (m: bigint, currency: string) => `${toMajor(m, currency) || "0"} ${currency}`;
const uuidField = (description: string) => ({ type: "string", description });

/** AI tools of the crm module, registered in src/server/modules/tools/modules.ts. Use `def` from tools/define. */
export const CRM_TOOLS: Record<string, ToolDefinition> = {
  read_deals: def({
    name: "read_deals",
    version: 1,
    description:
      "Lists CRM deals (opportunities) with account, stage, status, amount, probability, weighted value, expected close date and owner. Optional filters: status (OPEN, WON, LOST), q (search text), stale (true = only deals flagged stale).",
    input: z.object({ status: z.enum(["OPEN", "WON", "LOST"]).optional(), q: z.string().trim().max(200).optional(), stale: z.boolean().optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["OPEN", "WON", "LOST"] }, q: { type: "string", description: "Search text" }, stale: { type: "boolean" } },
      required: [],
      additionalProperties: false,
    },
    permissions: ["sales.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read CRM deals",
    async execute(input, { ctx, organizationId, companyId }) {
      const f = parseDealFilters({ status: input.status, q: input.q, stale: input.stale ? "1" : undefined, sort: "close" });
      const { rows, total } = await listDeals(ctx, organizationId, companyId, f, { take: 100 });
      if (!rows.length) return { content: "No deals match.", count: 0 };
      const lines = rows.map(
        (d) =>
          `- ${d.id} ${d.name}${d.account ? ` (${d.account.name})` : ""} [${d.pipeline.name} / ${d.stage.name}, ${d.status}] ${money(d.amountMinor, d.currency)} · ${d.effectiveProbability}% · weighted ${money(d.weightedMinor, d.currency)} · close ${isoDay(d.expectedCloseDate) ?? "none"} · owner ${d.ownerName ?? "unassigned"}${d.staleSince ? " · STALE" : ""}${d.lostReason ? ` · lost: ${d.lostReason}` : ""}`,
      );
      return { content: `${total} deals${total > rows.length ? ` (showing ${rows.length})` : ""}:\n${lines.join("\n")}`, count: rows.length, records: rows.map((d) => `crm_deal:${d.id}`) };
    },
  }),

  read_deal: def({
    name: "read_deal",
    version: 1,
    description: "Returns one deal's full record: account, contact, owner, pipeline stages, amount, probability, expected close, source, campaign, stage history, activity timeline and follow-ups.",
    input: z.object({ dealId: z.string().uuid() }).strict(),
    modelSchema: { type: "object", properties: { dealId: uuidField("Deal id") }, required: ["dealId"], additionalProperties: false },
    permissions: ["sales.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read a CRM deal",
    async execute({ dealId }, { ctx, organizationId, companyId }) {
      const d = await getDeal(ctx, organizationId, companyId, dealId);
      const w = await subjectWorkspace(ctx, organizationId, companyId, "deal", d.id);
      const lines = [
        `Deal ${d.id}: ${d.name}${d.archivedAt ? " [ARCHIVED]" : ""}`,
        `Account: ${d.account ? `${d.account.name} (${d.account.id})` : "none"} · Contact: ${d.contact ? `${contactName(d.contact)}${d.contact.email ? ` <${d.contact.email}>` : ""}` : "none"} · Owner: ${d.ownerName ?? "unassigned"}`,
        `Pipeline: ${d.pipeline.name} · Stage: ${d.stage.name} (${d.status}) · Stages: ${d.pipeline.stages.map((s) => `${s.name} [${s.id}]`).join(", ")}`,
        `Amount: ${money(d.amountMinor, d.currency)} · Probability: ${d.effectiveProbability}% · Weighted: ${money(d.weightedMinor, d.currency)} · Expected close: ${isoDay(d.expectedCloseDate) ?? "none"}`,
        `Source: ${d.source ?? "unknown"} · Campaign: ${d.campaignCode ?? "none"} · Created: ${isoDay(d.createdAt)} · In stage since: ${isoDay(d.stageEnteredAt)}${d.staleSince ? " · STALE" : ""}${d.lostReason ? ` · Lost reason: ${d.lostReason}` : ""}`,
        `Description: ${d.description ?? "none"}`,
        "",
        "Stage history:",
        ...(d.stageHistory.length ? d.stageHistory.map((h) => `- ${isoDay(h.changedAt)} ${h.from ?? "start"} → ${h.to ?? "?"}${h.by ? ` by ${h.by}` : ""}`) : ["- none"]),
        "",
        "Activity timeline (newest first):",
        ...(w.activities.length ? w.activities.slice(0, 50).map((a) => `- ${a.occurredAt.toISOString().slice(0, 16)} ${a.type}${a.author ? ` by ${a.author}` : ""}: ${a.subject ? `${a.subject} — ` : ""}${a.summary}`) : ["- none"]),
        "",
        "Follow-ups:",
        ...(w.followUps.length ? w.followUps.map((f) => `- ${isoDay(f.dueAt)} [${f.completedAt ? "done" : "open"}, ${f.priority}] ${f.note}${f.assigneeName ? ` (${f.assigneeName})` : ""}`) : ["- none"]),
      ];
      return { content: lines.join("\n"), count: 1, records: [`crm_deal:${d.id}`] };
    },
  }),

  read_pipeline_summary: def({
    name: "read_pipeline_summary",
    version: 1,
    description:
      "Pipeline and sales overview: per-stage deal counts, totals and weighted values for a pipeline (default pipeline unless pipelineId given), this month's headline numbers (new leads, won revenue, win rate, average deal size, sales cycle, stale deals) and the weighted forecast by month and by owner for the next 6 months.",
    input: z.object({ pipelineId: z.string().uuid().optional() }).strict(),
    modelSchema: { type: "object", properties: { pipelineId: uuidField("Optional pipeline id") }, required: [], additionalProperties: false },
    permissions: ["sales.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: () => "Read the sales pipeline summary",
    async execute({ pipelineId }, { ctx, organizationId, companyId }) {
      const board = await pipelineBoard(ctx, organizationId, companyId, pipelineId);
      const s = await salesSummary(ctx, organizationId, companyId, parseSalesRange({}));
      const f = await salesForecast(ctx, organizationId, companyId, { pipelineId: board.pipeline.id });
      const c = board.currency;
      const pct = (v: number | null) => (v == null ? "n/a" : `${Math.round(v * 100)}%`);
      const lines = [
        `Pipelines: ${board.pipelines.map((p) => `${p.name} [${p.id}]`).join(", ")}`,
        `Pipeline "${board.pipeline.name}" (stale after ${board.pipeline.staleDays} days), totals in ${c}:`,
        ...board.stages.map(
          (st) =>
            `- ${st.name} [${st.type}, ${st.probability}%]: ${st.deals.length} deals, ${money(st.totalMinor, c)}, weighted ${money(st.weightedMinor, c)}${st.deals.some((d) => d.stale) ? `, ${st.deals.filter((d) => d.stale).length} stale` : ""}`,
        ),
        "",
        `This month: ${s.newLeads} new leads · ${s.dealsCreated} deals created · ${s.wonCount} won (${money(s.wonMinor, c)}) · ${s.lostCount} lost · win rate ${pct(s.winRate)} · avg deal ${money(s.avgDealMinor, c)} · sales cycle ${s.cycleDays == null ? "n/a" : `${Math.round(s.cycleDays)} days`}`,
        `Open pipeline (all pipelines): ${s.openCount} deals, ${money(s.openMinor, c)}, weighted ${money(s.weightedMinor, c)}, ${s.staleCount} stale`,
        "",
        "Forecast by expected close month (best case / commit ≥75% / weighted / already won):",
        ...f.byMonth.map((m) => `- ${m.month}: ${m.count} deals · ${money(m.bestCaseMinor, c)} / ${money(m.commitMinor, c)} / ${money(m.weightedMinor, c)} / won ${money(m.wonMinor, c)}`),
        "",
        "Weighted forecast by owner:",
        ...(f.byOwner.length ? f.byOwner.map((o) => `- ${o.name ?? "Unassigned"}: ${o.count} deals, best case ${money(o.bestCaseMinor, c)}, weighted ${money(o.weightedMinor, c)}`) : ["- none"]),
      ];
      return { content: lines.join("\n"), count: board.stages.reduce((n, st) => n + st.deals.length, 0) };
    },
  }),

  read_contacts: def({
    name: "read_contacts",
    version: 1,
    description: "Lists CRM contacts (name, title, email, phone, account, owner, tags). Optional: q (search name, email, title or company), accountId.",
    input: z.object({ q: z.string().trim().max(200).optional(), accountId: z.string().uuid().optional() }).strict(),
    modelSchema: { type: "object", properties: { q: { type: "string" }, accountId: uuidField("Optional account id") }, required: [], additionalProperties: false },
    permissions: ["sales.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read CRM contacts",
    async execute(input, { ctx, organizationId, companyId }) {
      const { rows, total } = await listContacts(ctx, organizationId, companyId, { q: input.q, accountId: input.accountId }, { take: 100 });
      if (!rows.length) return { content: "No contacts match.", count: 0 };
      const lines = rows.map(
        (c) =>
          `- ${c.id} ${contactName(c)}${c.title ? `, ${c.title}` : ""}${c.account ? ` @ ${c.account.name} (${c.account.id})` : ""} · ${c.email ?? "no email"} · ${c.phone ?? "no phone"} · owner ${c.owner?.name ?? "unassigned"}${c.tags.length ? ` · tags ${c.tags.join(", ")}` : ""}`,
      );
      return { content: `${total} contacts${total > rows.length ? ` (showing ${rows.length})` : ""}:\n${lines.join("\n")}`, count: rows.length, records: rows.map((c) => `contact:${c.id}`) };
    },
  }),

  read_account: def({
    name: "read_account",
    version: 1,
    description: "Returns one account (company) with type, industry, website, owner, notes, its contacts, its deals and the recent activity timeline across the account, its contacts and deals.",
    input: z.object({ accountId: z.string().uuid() }).strict(),
    modelSchema: { type: "object", properties: { accountId: uuidField("Account id") }, required: ["accountId"], additionalProperties: false },
    permissions: ["sales.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read a CRM account",
    async execute({ accountId }, { ctx, organizationId, companyId }) {
      const a = await getAccount(ctx, organizationId, companyId, accountId);
      const w = await subjectWorkspace(ctx, organizationId, companyId, "account", a.id);
      const openFollowUps = w.followUps.filter((f) => !f.completedAt);
      const lines = [
        `Account ${a.id}: ${a.name} [${a.type}]${a.archivedAt ? " [ARCHIVED]" : ""}`,
        `Industry: ${a.industry ?? "unknown"} · Website: ${a.website ?? a.domain ?? "none"} · Country: ${a.countryCode ?? "unknown"} · Territory: ${a.territory ?? "none"} · Source: ${a.source ?? "unknown"} · Owner: ${a.owner?.name ?? "unassigned"}`,
        `Tags: ${a.tags.join(", ") || "none"} · Notes: ${a.notes ?? "none"}`,
        "",
        "Contacts:",
        ...(a.contacts.length ? a.contacts.map((c) => `- ${c.id} ${contactName(c)}${c.title ? `, ${c.title}` : ""} · ${c.email ?? "no email"}`) : ["- none"]),
        "",
        "Deals:",
        ...(a.crmDeals.length
          ? a.crmDeals.map((d) => `- ${d.id} ${d.name} [${d.stage.name}, ${d.status}] ${money(d.amountMinor, d.currency)} · close ${isoDay(d.expectedCloseDate) ?? "none"} · owner ${d.ownerName ?? "unassigned"}`)
          : ["- none"]),
        "",
        "Recent activity:",
        ...(w.activities.length ? w.activities.slice(0, 40).map((x) => `- ${x.occurredAt.toISOString().slice(0, 16)} ${x.type}${x.author ? ` by ${x.author}` : ""}: ${x.subject ? `${x.subject} — ` : ""}${x.summary}`) : ["- none"]),
        "",
        "Open follow-ups:",
        ...(openFollowUps.length ? openFollowUps.map((f) => `- ${isoDay(f.dueAt)} ${f.note}`) : ["- none"]),
      ];
      return { content: lines.join("\n"), count: 1, records: [`account:${a.id}`] };
    },
  }),

  create_follow_up: def({
    name: "create_follow_up",
    version: 1,
    description: "Propose a follow-up (reminder with a due date) on a lead, deal, contact or account. A person must approve it before it is created.",
    input: z
      .object({
        subjectType: z.enum(["lead", "deal", "contact", "account"]),
        subjectId: z.string().uuid(),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        note: z.string().trim().min(1).max(1000),
        priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        subjectType: { type: "string", enum: ["lead", "deal", "contact", "account"] },
        subjectId: uuidField("Id of the lead, deal, contact or account"),
        dueDate: { type: "string", description: "YYYY-MM-DD" },
        note: { type: "string", description: "The next step" },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
      },
      required: ["subjectType", "subjectId", "dueDate", "note"],
      additionalProperties: false,
    },
    permissions: ["sales.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ note, dueDate }) => `Add follow-up "${note.slice(0, 80)}" due ${dueDate}`,
    async execute(input, { ctx, organizationId, companyId }) {
      const priority = input.priority ?? "MEDIUM";
      if (input.subjectType === "lead") {
        const f = await addFollowUp(ctx, organizationId, companyId, input.subjectId, { dueAt: input.dueDate, note: input.note, priority });
        return { content: `Follow-up added for ${input.dueDate}.`, records: [`lead:${input.subjectId}`, `lead_follow_up:${f.id}`] };
      }
      const f = await addCrmFollowUp(ctx, organizationId, companyId, { subjectType: input.subjectType, subjectId: input.subjectId, dueAt: input.dueDate, note: input.note, priority });
      return { content: `Follow-up added for ${input.dueDate}.`, records: [`${input.subjectType}:${input.subjectId}`, `crm_follow_up:${f.id}`] };
    },
  }),

  update_deal_stage: def({
    name: "update_deal_stage",
    version: 1,
    description:
      "Propose moving a deal to another stage of its pipeline (stage ids are listed by read_deal), or marking it won / lost with `outcome`. Lost needs a lostReason. A person must approve before it changes.",
    input: z
      .object({ dealId: z.string().uuid(), stageId: z.string().uuid().optional(), outcome: z.enum(["won", "lost"]).optional(), lostReason: z.string().trim().max(300).optional() })
      .strict()
      .refine((v) => !!v.stageId !== !!v.outcome, { message: "Give either stageId or outcome" }),
    modelSchema: {
      type: "object",
      properties: {
        dealId: uuidField("Deal id"),
        stageId: uuidField("Target stage id (or use outcome)"),
        outcome: { type: "string", enum: ["won", "lost"] },
        lostReason: { type: "string" },
      },
      required: ["dealId"],
      additionalProperties: false,
    },
    permissions: ["sales.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ outcome, stageId }) => (outcome ? `Mark a deal ${outcome}` : `Move a deal to stage ${stageId}`),
    async execute(input, { ctx, organizationId, companyId }) {
      const d = input.outcome
        ? await closeDeal(ctx, organizationId, companyId, input.dealId, { outcome: input.outcome, lostReason: input.lostReason })
        : await moveDealStage(ctx, organizationId, companyId, input.dealId, { stageId: input.stageId!, lostReason: input.lostReason });
      return { content: `Deal "${d.name}" is now ${d.status}.`, records: [`crm_deal:${d.id}`] };
    },
  }),

  create_deal: def({
    name: "create_deal",
    version: 1,
    description: 'Propose creating a deal (opportunity) in the default pipeline\'s first stage, optionally for an account/contact. Amount in major units (e.g. "12000.50"). A person must approve it.',
    input: z
      .object({
        name: z.string().trim().min(1).max(200),
        accountId: z.string().uuid().optional(),
        contactId: z.string().uuid().optional(),
        amount: z
          .string()
          .trim()
          .regex(/^\d{1,12}(\.\d{1,2})?$/)
          .optional(),
        expectedCloseDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        source: z.string().trim().max(100).optional(),
        description: z.string().trim().max(2000).optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        accountId: uuidField("Account id"),
        contactId: uuidField("Contact id"),
        amount: { type: "string", description: "Major units, e.g. 12000.50" },
        expectedCloseDate: { type: "string", description: "YYYY-MM-DD" },
        source: { type: "string" },
        description: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    permissions: ["sales.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ name, amount }) => `Create deal "${name}"${amount ? ` (${amount})` : ""}`,
    async execute(input, { ctx, organizationId, companyId }) {
      const d = await createDeal(ctx, organizationId, companyId, { ...input, ownerId: ctx.actor.id ?? undefined, source: input.source ?? "AI agent" });
      return { content: `Created deal "${d.name}".`, records: [`crm_deal:${d.id}`] };
    },
  }),

  read_proposals: def({
    name: "read_proposals",
    version: 1,
    description:
      "Reads sales proposals. With proposalId: the full proposal (deal, contact, status, version, sections, line items with computed totals, valid-until, sends and decision). Without: a list, optionally filtered by dealId, status (DRAFT, SENT, VIEWED, ACCEPTED, DECLINED, EXPIRED) or q (search text).",
    input: z
      .object({
        proposalId: z.string().uuid().optional(),
        dealId: z.string().uuid().optional(),
        status: z.enum(["DRAFT", "SENT", "VIEWED", "ACCEPTED", "DECLINED", "EXPIRED"]).optional(),
        q: z.string().trim().max(200).optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        proposalId: uuidField("Proposal id"),
        dealId: uuidField("Deal id"),
        status: { type: "string", enum: ["DRAFT", "SENT", "VIEWED", "ACCEPTED", "DECLINED", "EXPIRED"] },
        q: { type: "string", description: "Search text" },
      },
      required: [],
      additionalProperties: false,
    },
    permissions: ["sales.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read sales proposals",
    async execute(input, { ctx, organizationId, companyId }) {
      if (input.proposalId) {
        const p = await getProposal(ctx, organizationId, companyId, input.proposalId);
        const lines = [
          `Proposal ${p.id} ${p.number}: ${p.title} [${p.status}, v${p.version}]${p.archivedAt ? " [ARCHIVED]" : ""}`,
          `Deal: ${p.deal.name} (${p.deal.id}) · Account: ${p.account?.name ?? "none"} · Contact: ${p.contact ? `${contactName(p.contact)}${p.contact.email ? ` <${p.contact.email}>` : ""}` : "none"} · Owner: ${p.ownerName ?? "unassigned"}`,
          `Valid until: ${isoDay(p.validUntil) ?? "not set"} · Sent: ${p.sentAt ? `${isoDay(p.sentAt)} to ${p.sentTo}` : "never"} · Viewed: ${p.viewCount} times${p.decidedAt ? ` · Decision ${isoDay(p.decidedAt)} by ${p.decisionName}${p.decisionNote ? `: ${p.decisionNote}` : ""}` : ""}`,
          "",
          "Line items:",
          ...(p.lines.length
            ? p.lines.map((l) => `- ${l.description}: ${l.quantityMilli / 1000} × ${money(l.unitPriceMinor, p.currency)}${l.discountBps ? ` −${l.discountBps / 100}%` : ""}${l.taxBps ? ` +${l.taxBps / 100}% tax` : ""} = ${money(l.totalMinor, p.currency)}`)
            : ["- none"]),
          `Subtotal ${money(p.subtotalMinor, p.currency)} · Discount ${money(p.discountMinor, p.currency)} · Tax ${money(p.taxMinor, p.currency)} · Total ${money(p.totalMinor, p.currency)}`,
          "",
          `## Introduction\n${p.intro || "(empty)"}`,
          `## Scope\n${p.scope || "(empty)"}`,
          `## Timeline\n${p.timeline || "(empty)"}`,
          `## Terms\n${p.terms || "(empty)"}`,
        ];
        return { content: lines.join("\n"), count: 1, records: [`crm_proposal:${p.id}`] };
      }
      const f = parseProposalFilters({ deal: input.dealId, status: input.status, q: input.q });
      const { rows, total } = await listProposals(ctx, organizationId, companyId, f, { take: 100 });
      if (!rows.length) return { content: "No proposals match.", count: 0 };
      const lines = rows.map((p) => `- ${p.id} ${p.number} ${p.title} [${p.status}, v${p.version}] deal ${p.deal.name} · ${money(p.totalMinor, p.currency)} · valid until ${isoDay(p.validUntil) ?? "not set"}`);
      return { content: `${total} proposals${total > rows.length ? ` (showing ${rows.length})` : ""}:\n${lines.join("\n")}`, count: rows.length, records: rows.map((p) => `crm_proposal:${p.id}`) };
    },
  }),

  create_proposal_draft: def({
    name: "create_proposal_draft",
    version: 1,
    description:
      "Propose creating a DRAFT sales proposal for a deal: title, the four sections (intro, scope, timeline, terms; plain paragraphs, '- ' lists, **bold**), optional line items (prices in major units of the deal currency; totals are computed by the system) and a valid-until date. It is created only after a person approves, and it is never sent to the customer by this tool.",
    input: z
      .object({
        dealId: z.string().uuid(),
        title: z.string().trim().min(1).max(200),
        intro: z.string().max(20_000).optional(),
        scope: z.string().max(20_000).optional(),
        timeline: z.string().max(20_000).optional(),
        terms: z.string().max(20_000).optional(),
        validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        lines: z
          .array(z.object({ description: z.string().trim().min(1).max(500), quantity: z.string().regex(/^\d{1,9}(\.\d{1,3})?$/), unitPrice: z.string().regex(/^\d{1,12}(\.\d{1,3})?$/), discount: z.string().optional(), tax: z.string().optional() }).strict())
          .max(50)
          .optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        dealId: uuidField("Deal id"),
        title: { type: "string" },
        intro: { type: "string" },
        scope: { type: "string" },
        timeline: { type: "string" },
        terms: { type: "string" },
        validUntil: { type: "string", description: "YYYY-MM-DD" },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantity: { type: "string", description: "e.g. 1 or 2.5" },
              unitPrice: { type: "string", description: "Major units, e.g. 1200.00" },
              discount: { type: "string", description: "Percent 0-100" },
              tax: { type: "string", description: "Percent 0-100" },
            },
            required: ["description", "quantity", "unitPrice"],
            additionalProperties: false,
          },
        },
      },
      required: ["dealId", "title"],
      additionalProperties: false,
    },
    permissions: ["sales.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ title }) => `Create proposal draft "${title}"`,
    async execute(input, { ctx, organizationId, companyId }) {
      const parsed = proposalInput.parse({ ...input, lines: input.lines ?? [] });
      const p = await transaction(async (tx) => {
        await authorize(ctx, organizationId, companyId, "sales.manage", tx);
        return insertProposal(tx, ctx, organizationId, companyId, parsed);
      });
      return { content: `Created draft proposal ${p.number} "${p.title}" (total ${money(p.totalMinor, p.currency)}). It has not been sent.`, records: [`crm_proposal:${p.id}`] };
    },
  }),
  read_next_actions: def({
    name: "read_next_actions",
    version: 1,
    description:
      "Lists the suggested next best actions for open leads and deals (or one record), most urgent first, each with its kind, priority (1 = today) and the record. Use it to decide what to work on.",
    input: z.object({ leadId: z.string().uuid().optional(), dealId: z.string().uuid().optional() }).strict(),
    modelSchema: { type: "object", properties: { leadId: uuidField("Only this lead"), dealId: uuidField("Only this deal") }, required: [], additionalProperties: false },
    permissions: ["sales.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read next best actions",
    async execute(input, { ctx, organizationId, companyId }) {
      const rows = await nextActions(ctx, organizationId, companyId, input);
      const lines = rows.slice(0, 40).map((s) => `${s.type} ${s.id} "${s.name}"${s.meta ? ` (${s.meta})` : ""}: ${s.actions.map((a) => `${a.kind}[p${a.priority}]`).join(", ")}`);
      return { content: lines.length ? lines.join("\n") : "No suggested actions.", records: rows.slice(0, 40).map((s) => `${s.type}:${s.id}`) };
    },
  }),
  read_lead_intel: def({
    name: "read_lead_intel",
    version: 1,
    description: "Reads the latest web research (facts with source URLs) and AI fit check (score, verdict, reasons, missing info) saved on a lead.",
    input: z.object({ leadId: z.string().uuid() }).strict(),
    modelSchema: { type: "object", properties: { leadId: uuidField("Lead id") }, required: ["leadId"], additionalProperties: false },
    permissions: ["sales.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 10_000,
    summarize: () => "Read lead research",
    async execute({ leadId }, { ctx, organizationId, companyId }) {
      const i = await latestIntel(ctx, organizationId, companyId, { leadId });
      const parts = [
        i.enrichment ? `Research (${i.enrichment.createdAt.toISOString().slice(0, 10)}): ${i.enrichment.summary}\n${i.enrichment.facts.map((f) => `- ${f.label}: ${f.value} [${f.sourceUrl ?? "no source"}]`).join("\n")}` : "No web research yet.",
        i.qualification ? `Fit check: ${i.qualification.fit}/100, ${i.qualification.verdict}. ${i.qualification.summary}\nMissing: ${i.qualification.missing.join("; ") || "none"}` : "No AI fit check yet.",
      ];
      return { content: parts.join("\n\n"), records: [`lead:${leadId}`] };
    },
  }),
  research_lead: def({
    name: "research_lead",
    version: 1,
    description:
      "Propose looking a lead's company up on the web through the connected research provider and saving the facts (with sources) on the lead. Runs only after a person approves; fails honestly when no research provider is connected.",
    input: z.object({ leadId: z.string().uuid() }).strict(),
    modelSchema: { type: "object", properties: { leadId: uuidField("Lead id") }, required: ["leadId"], additionalProperties: false },
    permissions: ["sales.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 60_000,
    summarize: () => "Research a lead's company on the web",
    async execute({ leadId }, { ctx, organizationId, companyId }) {
      const r = await enrichLead(ctx, organizationId, companyId, leadId);
      return { content: `Saved research from ${r.sources} web sources (${r.facts} facts).`, records: [`lead:${leadId}`] };
    },
  }),
  draft_outreach_email: def({
    name: "draft_outreach_email",
    version: 1,
    description:
      "Propose saving a personal email to a lead, contact or deal's contact in the outreach approval queue. Nothing is sent: a person reviews it in Outreach and sends it through the company's connected email. Give exactly one of leadId, contactId, dealId.",
    input: z
      .object({ leadId: z.string().uuid().optional(), contactId: z.string().uuid().optional(), dealId: z.string().uuid().optional(), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(10_000) })
      .strict()
      .refine((v) => [v.leadId, v.contactId, v.dealId].filter(Boolean).length === 1, { message: "Give exactly one of leadId, contactId, dealId" }),
    modelSchema: {
      type: "object",
      properties: { leadId: uuidField("Lead id"), contactId: uuidField("Contact id"), dealId: uuidField("Deal id"), subject: { type: "string" }, body: { type: "string", description: "Plain-text body" } },
      required: ["subject", "body"],
      additionalProperties: false,
    },
    permissions: ["sales.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ subject }) => `Queue email for approval: "${subject}"`,
    async execute(input, { ctx, organizationId, companyId }) {
      const m = await createOutreachDraft(ctx, organizationId, companyId, { ...input, submit: true }, { aiProvider: "agent" });
      return { content: `Saved "${input.subject}" to ${m.toEmail} in the approval queue. It has NOT been sent.`, records: [`crm_outreach_message:${m.id}`] };
    },
  }),
  enroll_in_sequence: def({
    name: "enroll_in_sequence",
    version: 1,
    description:
      "Propose adding leads or contacts to an existing follow-up sequence. Runs after a person approves; each sequence email still follows the sequence's own approval setting.",
    input: z.object({ sequenceId: z.string().uuid(), leadIds: z.array(z.string().uuid()).max(50).optional(), contactIds: z.array(z.string().uuid()).max(50).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { sequenceId: uuidField("Sequence id"), leadIds: { type: "array", items: { type: "string" } }, contactIds: { type: "array", items: { type: "string" } } },
      required: ["sequenceId"],
      additionalProperties: false,
    },
    permissions: ["sales.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ leadIds, contactIds }) => `Add ${(leadIds?.length ?? 0) + (contactIds?.length ?? 0)} people to a sequence`,
    async execute(input, { ctx, organizationId, companyId }) {
      const r = await enroll(ctx, organizationId, companyId, input.sequenceId, { leadIds: input.leadIds ?? [], contactIds: input.contactIds ?? [] });
      return { content: `Added ${r.enrolled} people (${r.skipped} skipped).`, records: [`crm_cadence:${input.sequenceId}`] };
    },
  }),

  read_prospecting_autopilots: def({
    name: "read_prospecting_autopilots",
    version: 1,
    description:
      "Lists the company's prospecting autopilots (AI SDR) with their ideal-customer profile, autonomy, daily caps and the real funnel: companies checked, people found, verified emails, contacted, replied, meetings, emails awaiting approval and sent today.",
    input: z.object({}).strict(),
    modelSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    permissions: ["sales.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read prospecting autopilots",
    async execute(_input, { ctx, organizationId, companyId }) {
      const rows = await listAutopilots(ctx, organizationId, companyId);
      if (!rows.length) return { content: "No prospecting autopilot is set up yet (/crm/prospecting)." };
      const lines = rows.map(
        (a) =>
          `- ${a.id} "${a.name}" [${a.status}, ${a.effective.level}${a.effective.limitedBy ? ` (limited: ${a.effective.limitedBy})` : ""}] who: ${a.audience}; roles: ${a.roles.join(", ") || "any"}; regions: ${a.regions.join(", ") || "any"}; quota ${a.dailyQuota}/day, send cap ${a.dailySendCap}/day${a.allowUnverified ? `, unverified allowed (${a.unverifiedDailyCap}/day)` : ""}. Funnel: ${a.funnel.companies} companies → ${a.funnel.found} found → ${a.funnel.verified} verified → ${a.funnel.contacted} contacted → ${a.funnel.replied} replied → ${a.funnel.meetings} meetings; ${a.funnel.awaitingApproval} awaiting approval, ${a.funnel.sentToday} sent today${a.lastError ? `; last issue: ${a.lastError}` : ""}`,
      );
      return { content: lines.join("\n"), records: rows.map((a) => `crm_prospecting_autopilot:${a.id}`) };
    },
  }),

  find_decision_makers: def({
    name: "find_decision_makers",
    version: 1,
    description:
      "Propose looking up decision makers at a company domain through the connected contact-data provider (Apollo.io, People Data Labs or Hunter.io): names, titles and work emails with their verification status, exactly as the provider returns them. Uses provider credits, so it runs after a person approves. Nothing is stored or sent.",
    input: z.object({ domain: z.string().trim().min(3).max(253), titles: z.array(z.string().trim().min(1).max(80)).max(10).optional(), seniorities: z.array(z.enum(SENIORITIES)).max(10).optional(), limit: z.number().int().min(1).max(10).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Company website domain, e.g. acme.com" },
        titles: { type: "array", items: { type: "string" }, description: "Job titles to look for" },
        seniorities: { type: "array", items: { type: "string", enum: [...SENIORITIES] } },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["domain"],
      additionalProperties: false,
    },
    permissions: ["sales.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 45_000,
    summarize: ({ domain }) => `Look up decision makers at ${domain}`,
    async execute(input, { ctx, organizationId, companyId }) {
      await authorize(ctx, organizationId, companyId, "sales.manage");
      const r = await findPeople(organizationId, companyId, { domain: input.domain, titles: input.titles, seniorities: input.seniorities, limit: input.limit ?? 5 });
      if (!r.ok) return { content: r.code === "not_connected" ? "No contact-data provider is connected (Apollo.io, Hunter.io or People Data Labs) — connect one in Integrations. Nothing was looked up." : `The contact-data provider could not answer: ${r.error}` };
      if (!r.data.people.length) return { content: `${r.providerId} found no matching people at ${input.domain}.` };
      const lines = r.data.people.map((p) => `- ${p.fullName}${p.title ? `, ${p.title}` : ""}: ${p.email ? `${p.email} (${p.emailStatus.toLowerCase()}, from ${p.emailSource})` : "no email returned"}${p.linkedinUrl ? ` · ${p.linkedinUrl}` : ""}`);
      return { content: `From ${r.providerId}:\n${lines.join("\n")}\nOnly verified addresses should be contacted.` };
    },
  }),
};
