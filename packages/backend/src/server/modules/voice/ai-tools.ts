import { z } from "zod";
import { db } from "@/server/core/db";
import { notFound } from "@/server/core/errors";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { approveAndDial, callingBlocked, createApprovedCall, getCall, listCalls } from "./calls";
import { startApprovedCampaign } from "./campaigns";
import { maskNumber, OUTCOMES, type TranscriptLine } from "./common";
import { executeRun, getRun, listRuns, planRun, RUN_STAGES, runReport } from "./runs";
import { sendFollowUpEmail } from "@/server/modules/crm/meeting-intel";

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—");

/**
 * AI tools of the phone team, registered in src/server/modules/tools/modules.ts. Reads are autonomous; placing a call
 * and running a campaign are external actions (SUPERVISED + HIGH): the gateway files an approval and the call is dialled
 * only after a person approved it (or the founder granted autonomy for this tool).
 */
export const VOICE_TOOLS: Record<string, ToolDefinition> = {
  read_voice_calls: def({
    name: "read_voice_calls",
    version: 1,
    description: "List recent AI phone calls (newest first): direction, person, status, outcome, sentiment, duration and summary. Filter by lead, contact or outcome.",
    input: z.object({ leadId: z.string().uuid().optional(), contactId: z.string().uuid().optional(), outcome: z.enum(OUTCOMES).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { leadId: { type: "string", description: "CRM lead id" }, contactId: { type: "string", description: "CRM contact id" }, outcome: { type: "string", enum: [...OUTCOMES] } },
      additionalProperties: false,
    },
    permissions: ["communication.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read recent AI phone calls",
    async execute(input, { ctx, organizationId, companyId }) {
      const r = await listCalls(ctx, organizationId, companyId, { view: "all", leadId: input.leadId, contactId: input.contactId, outcome: input.outcome });
      const lines = r.rows.map((c) => `- ${c.id} · ${c.direction} · ${c.subjectName ?? maskNumber(c.direction === "INBOUND" ? (c.fromNumber ?? "") : c.toNumber)} · ${c.status} · outcome ${c.outcome ?? "—"} · sentiment ${c.sentiment ?? "—"} · ${c.durationSec ?? 0}s · ${iso(c.createdAt)}${c.summary ? `\n  ${c.summary.slice(0, 300)}` : ""}`);
      return { content: lines.length ? `${r.total} calls (showing ${lines.length}):\n${lines.join("\n")}` : "No AI phone calls match.", records: r.rows.map((c) => `voice_call:${c.id}`), count: r.rows.length };
    },
  }),

  read_voice_call: def({
    name: "read_voice_call",
    version: 1,
    description: "Read one AI phone call: who, why, status, outcome, sentiment, summary, structured analysis, the records created after the call and the transcript.",
    input: z.object({ callId: z.string().uuid() }).strict(),
    modelSchema: { type: "object", properties: { callId: { type: "string", description: "Call id" } }, required: ["callId"], additionalProperties: false },
    permissions: ["communication.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ callId }) => `Read AI phone call ${callId}`,
    async execute({ callId }, { ctx, organizationId, companyId }) {
      const c = await getCall(ctx, organizationId, companyId, callId);
      const transcript = (Array.isArray(c.transcript) ? (c.transcript as unknown as TranscriptLine[]) : []).map((l) => `${l.role === "agent" ? "AI" : "Person"}: ${l.text}`).join("\n").slice(0, 8000);
      const content = [
        `Call ${c.id} · ${c.direction} · agent ${c.agent?.name ?? "—"} · status ${c.status}${c.blockedReason ? ` (${c.blockedReason})` : ""}`,
        `Person: ${c.subjectName ?? "unknown"} · lead ${c.leadId ?? "—"} · contact ${c.contactId ?? "—"}`,
        `Purpose: ${c.purpose ?? "—"}`,
        `Started ${iso(c.startedAt)} · duration ${c.durationSec ?? 0}s · outcome ${c.outcome ?? "—"} · sentiment ${c.sentiment ?? "—"}`,
        `Summary: ${c.summary ?? "—"}`,
        `Analysis: ${JSON.stringify(c.analysis ?? {})}`,
        `Created after the call: ${JSON.stringify(c.results ?? [])}`,
        `Transcript:\n${transcript || "(none)"}`,
      ].join("\n\n");
      return { content, records: [`voice_call:${c.id}`] };
    },
  }),

  place_voice_call: def({
    name: "place_voice_call",
    version: 1,
    description:
      "Call a CRM lead or contact with the company's AI voice agent (the agent says it is an AI). External action: a person approves it first. Give a concrete purpose; the call is placed within calling hours of the person's time zone and never to do-not-call numbers.",
    input: z
      .object({
        callId: z.string().uuid().optional(),
        /** Who is called (display only, set when a person requested the call). */
        label: z.string().trim().max(200).optional(),
        agentId: z.string().uuid().optional(),
        leadId: z.string().uuid().optional(),
        contactId: z.string().uuid().optional(),
        purpose: z.string().trim().min(3).max(1000).optional(),
      })
      .strict()
      .refine((v) => !!v.callId || ((!!v.leadId !== !!v.contactId) && !!v.purpose), { message: "Give callId, or exactly one of leadId/contactId plus a purpose" }),
    modelSchema: {
      type: "object",
      properties: {
        leadId: { type: "string", description: "CRM lead id to call" },
        contactId: { type: "string", description: "CRM contact id to call" },
        agentId: { type: "string", description: "Voice agent id (optional; default: the first outbound agent)" },
        purpose: { type: "string", description: "Why the call is made, in one or two sentences (the agent uses it)" },
      },
      required: ["purpose"],
      additionalProperties: false,
    },
    permissions: ["communication.post"],
    risk: "HIGH",
    autonomy: "SUPERVISED",
    timeoutMs: 45_000,
    summarize: (i) => (i.callId ? `AI phone call to ${i.label ?? "the requested person"}: ${i.purpose ?? ""}` : `AI phone call to ${i.leadId ? `lead ${i.leadId}` : `contact ${i.contactId}`}: ${i.purpose ?? ""}`),
    async execute(input, { ctx, organizationId, companyId }) {
      const blocked = await callingBlocked(organizationId, companyId);
      let callId = input.callId;
      if (callId) {
        const exists = await db().voiceCall.findFirst({ where: { id: callId, organizationId, companyId }, select: { id: true } });
        if (!exists) throw notFound("Call");
      } else {
        callId = (await createApprovedCall(ctx, organizationId, companyId, { agentId: input.agentId, leadId: input.leadId, contactId: input.contactId, purpose: input.purpose! })).id;
      }
      const r = await approveAndDial(organizationId, companyId, callId);
      return { content: `${r.detail}${blocked ? ` (AI calling is paused: ${blocked.replace(/_/g, " ")}; the call waits.)` : ""} Call record: ${callId}. Status: ${r.status}.`, records: [`voice_call:${callId}`] };
    },
  }),

  run_voice_campaign: def({
    name: "run_voice_campaign",
    version: 1,
    description: "Start an approved outbound AI call campaign: every listed person is called within calling hours by the campaign's voice agent.",
    input: z.object({ campaignId: z.string().uuid(), name: z.string().trim().max(120).optional(), people: z.number().int().min(0).max(1000).optional() }).strict(),
    modelSchema: { type: "object", properties: { campaignId: { type: "string" } }, required: ["campaignId"], additionalProperties: false },
    permissions: ["communication.post"],
    risk: "HIGH",
    autonomy: "SUPERVISED",
    timeoutMs: 20_000,
    summarize: ({ campaignId, name, people }) => `Start AI call campaign "${name ?? campaignId}": ${people ?? "each"} ${people === 1 ? "person is" : "people are"} called by the AI voice agent within calling hours`,
    async execute({ campaignId }, { organizationId, companyId }) {
      const r = await startApprovedCampaign(organizationId, companyId, campaignId);
      return { content: r.detail, records: [`voice_campaign:${campaignId}`] };
    },
  }),

  start_calling_campaign: def({
    name: "start_calling_campaign",
    version: 1,
    description:
      "Run an autonomous AI calling campaign, e.g. \"call 100 qualified leads and book demos\": picks CRM leads by stage/score/tags, skips anyone without consent, on the do-not-call or suppression list, unsubscribed or called recently, prioritises them, builds a context brief per lead from the CRM, then the AI voice agent calls them within calling hours (it always says it is an AI), qualifies them, books meetings and creates follow-ups. External action: a person approves the whole run first. Give runId of a planned run, or goal + purpose (+ criteria) to plan and start in one step.",
    input: z
      .object({
        runId: z.string().uuid().optional(),
        name: z.string().trim().max(120).optional(),
        people: z.number().int().min(0).max(1000).optional(),
        goal: z.string().trim().min(3).max(500).optional(),
        purpose: z.string().trim().min(3).max(600).optional(),
        agentId: z.string().uuid().optional(),
        maxConcurrent: z.number().int().min(1).max(10).optional(),
        criteria: z
          .object({
            stages: z.array(z.enum(RUN_STAGES)).min(1).max(4).optional(),
            minScore: z.number().int().min(0).max(100).optional(),
            labels: z.array(z.enum(["HOT", "WARM", "NURTURE"])).max(3).optional(),
            tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
            qualifiedOnly: z.boolean().optional(),
            maxCalls: z.number().int().min(1).max(200).optional(),
            cooldownDays: z.number().int().min(0).max(90).optional(),
            consent: z.enum(["lawful_basis", "recorded_only"]).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .refine((v) => !!v.runId || (!!v.goal && !!v.purpose), { message: "Give runId, or goal and purpose" }),
    modelSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "A planned calling run (from /voice/campaigns)" },
        goal: { type: "string", description: "The instruction in plain words, e.g. 'Call 100 qualified leads and book demos'" },
        purpose: { type: "string", description: "What the agent should achieve on each call (one or two sentences)" },
        agentId: { type: "string", description: "Voice agent id (optional; default: the first outbound agent)" },
        maxConcurrent: { type: "number", description: "Calls at once for this run (1–10)" },
        criteria: {
          type: "object",
          properties: {
            stages: { type: "array", items: { type: "string", enum: [...RUN_STAGES] } },
            minScore: { type: "number", description: "Minimum lead score 0–100" },
            labels: { type: "array", items: { type: "string", enum: ["HOT", "WARM", "NURTURE"] } },
            tags: { type: "array", items: { type: "string" } },
            qualifiedOnly: { type: "boolean" },
            maxCalls: { type: "number", description: "At most this many people (1–200)" },
            cooldownDays: { type: "number", description: "Skip leads called in the last N days" },
            consent: { type: "string", enum: ["lawful_basis", "recorded_only"] },
          },
          additionalProperties: false,
        },
      },
      required: [],
      additionalProperties: false,
    },
    permissions: ["communication.post"],
    risk: "HIGH",
    autonomy: "SUPERVISED",
    actionClass: "call",
    channel: "phone",
    timeoutMs: 120_000,
    summarize: (i) =>
      i.runId
        ? `Start AI calling run "${i.name ?? i.runId}": ${i.people ?? "the eligible"} ${i.people === 1 ? "lead is" : "leads are"} called by the AI voice agent within calling hours (do-not-call re-checked before each call)`
        : `Plan and start an AI calling run — "${i.goal}": up to ${i.criteria?.maxCalls ?? 100} leads (${(i.criteria?.stages ?? ["QUALIFIED"]).join(", ").toLowerCase()}${i.criteria?.minScore !== undefined ? `, score ≥ ${i.criteria.minScore}` : ""}); consent, do-not-call and suppression are checked first`,
    async execute(input, { ctx, organizationId, companyId }) {
      let runId = input.runId;
      let planned = "";
      if (!runId) {
        const p = await planRun(ctx, organizationId, companyId, { goal: input.goal!, purpose: input.purpose!, agentId: input.agentId, maxConcurrent: input.maxConcurrent, criteria: input.criteria ?? {} }, { profile: "ai" });
        runId = p.runId;
        planned = `Considered ${p.eligibility.considered} leads, ${p.eligibility.eligible} eligible; skipped: ${JSON.stringify(p.eligibility.skipped)}. `;
      }
      const r = await executeRun(ctx, organizationId, companyId, runId);
      return { content: `${planned}${r.detail} Run: ${runId}.`, records: [`voice_calling_run:${runId}`, ...(r.campaignId ? [`voice_campaign:${r.campaignId}`] : [])] };
    },
  }),

  read_calling_runs: def({
    name: "read_calling_runs",
    version: 1,
    description: "Read AI calling runs (autonomous calling campaigns): status, eligibility, and for one run its report — calls placed, connected, conversations, qualified, meetings booked, follow-ups and cost per meeting.",
    input: z.object({ runId: z.string().uuid().optional() }).strict(),
    modelSchema: { type: "object", properties: { runId: { type: "string", description: "Run id for its full report" } }, additionalProperties: false },
    permissions: ["communication.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ runId }) => (runId ? `Read AI calling run ${runId}` : "Read AI calling runs"),
    async execute({ runId }, { ctx, organizationId, companyId }) {
      if (runId) {
        const run = await getRun(ctx, organizationId, companyId, runId);
        const report = await runReport(organizationId, companyId, runId);
        return { content: `Run "${run.name}" · ${run.status}\nGoal: ${run.goal}\nEligibility: ${JSON.stringify(run.eligibility)}\nReport: ${JSON.stringify(report)}${run.summary ? `\nSummary: ${run.summary}` : ""}`, records: [`voice_calling_run:${runId}`] };
      }
      const runs = await listRuns(ctx, organizationId, companyId);
      const lines = runs.slice(0, 20).map((r) => `- ${r.id} · ${r.name} · ${r.status} · ${JSON.stringify(r.stages)} · ${iso(r.createdAt)}`);
      return { content: lines.length ? lines.join("\n") : "No calling runs yet.", records: runs.slice(0, 20).map((r) => `voice_calling_run:${r.id}`), count: lines.length };
    },
  }),

  send_meeting_follow_up_email: def({
    name: "send_meeting_follow_up_email",
    version: 1,
    description: "Send the follow-up email of a customer meeting (drafted from its transcript) through the connected mailbox. External action: a person approves the exact text first; the result says whether it was sent.",
    input: z.object({ intelId: z.string().uuid(), to: z.string().trim().toLowerCase().email().max(254), subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(20_000) }).strict(),
    modelSchema: {
      type: "object",
      properties: { intelId: { type: "string" }, to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
      required: ["intelId", "to", "subject", "body"],
      additionalProperties: false,
    },
    permissions: ["communication.post"],
    risk: "HIGH",
    autonomy: "SUPERVISED",
    actionClass: "send_message",
    channel: "email",
    timeoutMs: 30_000,
    summarize: ({ to, subject, body }) => `Email ${to} — "${subject}": ${body.slice(0, 160)}`,
    async execute(input, { ctx, organizationId, companyId }) {
      const r = await sendFollowUpEmail(ctx, organizationId, companyId, input);
      return { content: r.status === "SENT" ? "The follow-up email was sent." : `The email was not sent (${r.status}).`, records: [`meeting_intel:${input.intelId}`] };
    },
  }),
};
