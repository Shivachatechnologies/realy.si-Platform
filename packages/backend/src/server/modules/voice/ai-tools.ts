import { z } from "zod";
import { db } from "@/server/core/db";
import { notFound } from "@/server/core/errors";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { approveAndDial, callingBlocked, createApprovedCall, getCall, listCalls } from "./calls";
import { startApprovedCampaign } from "./campaigns";
import { maskNumber, OUTCOMES, type TranscriptLine } from "./common";

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
      const blocked = await callingBlocked(organizationId);
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
};
