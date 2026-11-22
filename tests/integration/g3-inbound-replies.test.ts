import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { db } from "@/server/core/db";
import { createOrganization } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { setModelForTests } from "@/server/modules/agents/runtime";
import { ingestSupportEmail, ingestSupportWhatsApp } from "@/server/modules/support/inbound";
import { addMessage } from "@/server/modules/support/tickets";
import { updateSettings } from "@/server/modules/support/config";
import { actOnReply, classifyReply, processReply, resumeOutOfOffice } from "@/server/modules/crm/replies";
import { runCadences } from "@/server/modules/crm/cadences";
import { refreshCompanyWinProbabilities } from "@/server/modules/crm/win-probability";
import { makeUser, raiseLimits, resetDb } from "../helpers";

/**
 * G3 flows against the database: inbound email and WhatsApp become support tickets (deduped, threaded), replies to
 * outreach are classified and routed (suppression, out-of-office pause and resume, interested → follow-up), the
 * company kill switch stops AI and automatic sending, and deals get a computed win probability. Models are scripted
 * through the runtime's test seam; nothing is simulated in product code.
 */

vi.mock("@/i18n/server", () => import("@/worker/i18n-server"));

const calls: MessageCreateParamsNonStreaming[] = [];
function scripted(json: Record<string, unknown>) {
  calls.length = 0;
  setModelForTests(async (p) => {
    calls.push(p);
    return { id: "msg_test", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", usage: { input_tokens: 80, output_tokens: 30 }, content: [{ type: "text", text: JSON.stringify(json) }] } as unknown as BetaMessage;
  });
}
afterEach(() => setModelForTests(null));

let s: Awaited<ReturnType<typeof setup>>;
async function setup() {
  const owner = await makeUser({ name: "Mara Owner" });
  const org = await createOrganization(owner.ctx, { name: `G3 ${Math.random()}` });
  await raiseLimits(org.id, { "companies.max": 2 });
  const company = await createCompany(owner.ctx, org.id, { name: "Acme Support", incorporationCountryCode: "SI" });
  const account = await db().commsEmailAccount.create({ data: { organizationId: org.id, companyId: company.id, provider: "gmail", address: "help@acme.test", addedById: owner.user.id } });
  return { owner, org, company, account };
}

beforeAll(async () => {
  await resetDb();
  s = await setup();
});

let seq = 0;
async function inboundMail(opts: { from: string; subject: string; body: string; threadKey?: string; sentAt?: Date; to?: string[] }) {
  seq++;
  const providerThreadId = opts.threadKey ?? `t-${seq}`;
  const thread =
    (await db().commsEmailThread.findFirst({ where: { accountId: s.account.id, providerThreadId } })) ??
    (await db().commsEmailThread.create({ data: { organizationId: s.org.id, companyId: s.company.id, accountId: s.account.id, providerThreadId, subject: opts.subject } }));
  return db().commsEmailMessage.create({
    data: { companyId: s.company.id, threadId: thread.id, providerMessageId: `m-${seq}`, direction: "INBOUND", status: "RECEIVED", fromAddress: opts.from, toAddresses: opts.to ?? ["help@acme.test"], ccAddresses: [], subject: opts.subject, bodyText: opts.body, attachments: [], sentAt: opts.sentAt ?? new Date() },
  });
}
const ev = (id: string) => ({ organizationId: s.org.id, companyId: s.company.id, aggregateId: id });

describe("support email channel", () => {
  it("does nothing while the channel is off", async () => {
    const m = await inboundMail({ from: "Jane <jane@cust.test>", subject: "Login broken", body: "I cannot log in." });
    expect(await ingestSupportEmail(ev(m.id))).toBe("skipped");
  });

  it("turns mail to the support address into a ticket, threads replies and dedupes", async () => {
    await updateSettings(s.owner.ctx, s.org.id, s.company.id, { emailChannelEnabled: true, supportEmail: "help@acme.test" });
    const settings = await db().supportSettings.findUniqueOrThrow({ where: { companyId: s.company.id } });
    expect(settings.emailChannelEnabledAt).not.toBeNull();
    // Mail from before the channel was turned on is not imported.
    const old = await inboundMail({ from: "old@cust.test", subject: "Old", body: "old", sentAt: new Date(Date.now() - 3_600_000) });
    expect(await ingestSupportEmail(ev(old.id))).toBe("skipped");

    const first = await inboundMail({ from: "Jane Doe <jane@cust.test>", subject: "Invoice is wrong", body: "The total on invoice 42 is wrong.", threadKey: "conv-1" });
    expect(await ingestSupportEmail(ev(first.id))).toBe("created");
    expect(await ingestSupportEmail(ev(first.id))).toBe("duplicate");
    const ticket = await db().supportTicket.findFirstOrThrow({ where: { companyId: s.company.id, externalThreadKey: `email:${first.threadId}` }, include: { requester: true } });
    expect(ticket.channel).toBe("EMAIL");
    expect(ticket.subject).toBe("Invoice is wrong");
    expect(ticket.requester?.emailNormalized).toBe("jane@cust.test");
    expect(ticket.requester?.firstName).toBe("Jane");

    const reply = await inboundMail({ from: "jane@cust.test", subject: "Re: Invoice is wrong", body: "Here is a screenshot.\n\nOn Mon, Ana <help@acme.test> wrote:\n> Thanks", threadKey: "conv-1" });
    expect(await ingestSupportEmail(ev(reply.id))).toBe("appended");
    const msgs = await db().supportMessage.findMany({ where: { ticketId: ticket.id, authorType: "CUSTOMER" } });
    expect(msgs.map((m) => m.body)).toEqual(["Here is a screenshot."]);
    expect(await db().supportTicket.count({ where: { companyId: s.company.id } })).toBe(1);
  });

  it("threads a new mail with [#number] from the same requester, and skips bounces", async () => {
    const t = await db().supportTicket.findFirstOrThrow({ where: { companyId: s.company.id } });
    const m = await inboundMail({ from: "jane@cust.test", subject: `Re: [#${t.number}] Invoice is wrong`, body: "Any news?" });
    expect(await ingestSupportEmail(ev(m.id))).toBe("appended");
    const stranger = await inboundMail({ from: "eve@other.test", subject: `[#${t.number}] hi`, body: "Not the requester" });
    expect(await ingestSupportEmail(ev(stranger.id))).toBe("created");
    const bounce = await inboundMail({ from: "MAILER-DAEMON@mx.test", subject: "Undeliverable: hi", body: "failed" });
    expect(await ingestSupportEmail(ev(bounce.id))).toBe("skipped");
  });
});

describe("support WhatsApp channel", () => {
  const wa = (id: string, from: string, text: string) => ({ organizationId: s.org.id, companyId: s.company.id, aggregateId: id, payload: { companyId: s.company.id, entityId: id, data: { from, text } } });

  it("opens a WHATSAPP ticket, appends follow-ups, dedupes, and reports the reply's real delivery", async () => {
    expect(await ingestSupportWhatsApp(wa("wamid.1", "+38640111222", "My order has not arrived"))).toBe("skipped");
    await updateSettings(s.owner.ctx, s.org.id, s.company.id, { whatsappChannelEnabled: true });
    expect(await ingestSupportWhatsApp(wa("wamid.1", "+38640111222", "My order has not arrived"))).toBe("created");
    expect(await ingestSupportWhatsApp(wa("wamid.1", "+38640111222", "My order has not arrived"))).toBe("duplicate");
    expect(await ingestSupportWhatsApp(wa("wamid.2", "+38640111222", "Order 1001"))).toBe("appended");
    const t = await db().supportTicket.findFirstOrThrow({ where: { companyId: s.company.id, channel: "WHATSAPP" }, include: { requester: true } });
    expect(t.externalThreadKey).toBe("whatsapp:+38640111222");
    expect(t.requester?.phone).toBe("+38640111222");
    // No WhatsApp connection: the reply is stored, and the status says it was not sent.
    const r = await addMessage(s.owner.ctx, s.org.id, s.company.id, t.id, { kind: "PUBLIC_REPLY", body: "We are checking with the courier." });
    expect(r.emailStatus).toBe("WHATSAPP_NOT_CONFIGURED");
  });
});

describe("outreach reply classification", () => {
  async function enrollment(email: string) {
    const cadence = await db().crmCadence.create({
      data: { organizationId: s.org.id, companyId: s.company.id, name: `Seq ${email}`, status: "ACTIVE", autoSend: true, activatedAt: new Date(), activatedById: s.owner.user.id, createdById: s.owner.user.id },
    });
    await db().crmCadenceStep.createMany({
      data: [
        { organizationId: s.org.id, companyId: s.company.id, cadenceId: cadence.id, position: 0, delayDays: 0, subject: "Hi {{firstName}}", body: "Hello {{firstName}}" },
        { organizationId: s.org.id, companyId: s.company.id, cadenceId: cadence.id, position: 1, delayDays: 3, subject: "Follow-up", body: "Just checking" },
      ],
    });
    const lead = await db().lead.create({ data: { organizationId: s.org.id, companyId: s.company.id, name: "Pat Prospect", email, emailNormalized: email, currency: "EUR", score: 40, scoreLabel: "WARM", createdById: s.owner.user.id } });
    const e = await db().crmCadenceEnrollment.create({ data: { organizationId: s.org.id, companyId: s.company.id, cadenceId: cadence.id, leadId: lead.id, toEmail: email, name: "Pat Prospect", ownerId: s.owner.user.id, enrolledById: s.owner.user.id, nextRunAt: new Date(Date.now() + 86_400_000), createdAt: new Date(Date.now() - 86_400_000) } });
    return { cadence, lead, e };
  }
  const target = (x: Awaited<ReturnType<typeof enrollment>>, email: string) => ({ organizationId: s.org.id, companyId: s.company.id, email, name: "Pat Prospect", leadId: x.lead.id, ownerId: s.owner.user.id, enrollmentId: x.e.id, href: "/crm", repliedNotice: "crm.sequence_replied" });

  it("unsubscribe requests go on the do-not-contact list and stop everything", async () => {
    const x = await enrollment("pat1@prospect.test");
    const m = await inboundMail({ from: "pat1@prospect.test", subject: "Re: Hi", body: "Please remove me from your list." });
    const v = await classifyReply(s.org.id, s.company.id, m);
    expect(v).toMatchObject({ cls: "UNSUBSCRIBE", via: "rules" });
    await actOnReply(target(x, "pat1@prospect.test"), v, m);
    expect(await db().crmSuppression.findFirst({ where: { companyId: s.company.id, value: "pat1@prospect.test" } })).not.toBeNull();
    expect((await db().crmCadenceEnrollment.findUniqueOrThrow({ where: { id: x.e.id } })).status).toBe("STOPPED");
  });

  it("out-of-office pauses the sequence until the return date, then resumes it", async () => {
    const x = await enrollment("pat2@prospect.test");
    const back = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const m = await inboundMail({ from: "pat2@prospect.test", subject: "Automatic reply: Hi", body: `I am out of the office, back on ${back}.` });
    const out = await processReply(target(x, "pat2@prospect.test"), x.e.createdAt);
    expect(out).toMatchObject({ cls: "OUT_OF_OFFICE", paused: true });
    const paused = await db().crmCadenceEnrollment.findUniqueOrThrow({ where: { id: x.e.id } });
    expect(paused.status).toBe("PAUSED");
    expect(paused.replyResumeAt?.toISOString().slice(0, 10)).toBe(back);
    expect(paused.replyClassifiedAt?.getTime()).toBe(m.sentAt.getTime());
    // The same auto-reply is not processed twice.
    expect(await processReply(target(x, "pat2@prospect.test"), paused.replyClassifiedAt!)).toBeNull();
    expect(await resumeOutOfOffice(new Date(Date.now() + 6 * 86_400_000))).toBeGreaterThanOrEqual(1);
    expect((await db().crmCadenceEnrollment.findUniqueOrThrow({ where: { id: x.e.id } })).status).toBe("ACTIVE");
  });

  it("an interested reply (classified by the shared runtime) stops the sequence and creates a follow-up", async () => {
    const x = await enrollment("pat3@prospect.test");
    await inboundMail({ from: "pat3@prospect.test", subject: "Re: Hi", body: "Yes, this looks useful. Can we talk next week?" });
    scripted({ class: "INTERESTED", summary: "Wants a call next week.", return_date: "", referral_name: "", referral_email: "" });
    const out = await processReply(target(x, "pat3@prospect.test"), x.e.createdAt);
    expect(out?.cls).toBe("INTERESTED");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.output_config?.format).toBeTruthy();
    const e = await db().crmCadenceEnrollment.findUniqueOrThrow({ where: { id: x.e.id } });
    expect(e).toMatchObject({ status: "REPLIED", replyClass: "INTERESTED", stoppedReason: "replied_interested" });
    const f = await db().leadFollowUp.findUniqueOrThrow({ where: { id: out!.followUpId! } });
    expect(f.priority).toBe("HIGH");
    // The call is in the cost ledger.
    expect(await db().costLedgerEntry.count({ where: { companyId: s.company.id, operation: "crm.reply_classify" } })).toBe(1);
  });

  it("a referral creates a lead only for an address written in the reply", async () => {
    const x = await enrollment("pat4@prospect.test");
    await inboundMail({ from: "pat4@prospect.test", subject: "Re: Hi", body: "Not me — talk to Lena Novak, lena@prospect.test, she runs purchasing." });
    scripted({ class: "REFERRAL", summary: "Refers to Lena Novak.", return_date: "", referral_name: "Lena Novak", referral_email: "lena@prospect.test" });
    const out = await processReply(target(x, "pat4@prospect.test"), x.e.createdAt);
    expect(out?.cls).toBe("REFERRAL");
    const lead = await db().lead.findUniqueOrThrow({ where: { id: out!.referralLeadId! } });
    expect(lead).toMatchObject({ name: "Lena Novak", emailNormalized: "lena@prospect.test" });
  });

  it("the company kill switch: no AI classification and no automatic sequence sending", async () => {
    await db().autonomySettings.upsert({ where: { companyId: s.company.id }, create: { organizationId: s.org.id, companyId: s.company.id, paused: true, pausedAt: new Date() }, update: { paused: true } });
    try {
      scripted({ class: "INTERESTED", summary: "", return_date: "", referral_name: "", referral_email: "" });
      const m = await inboundMail({ from: "pat5@prospect.test", subject: "Re: Hi", body: "Tell me more about pricing." });
      expect(await classifyReply(s.org.id, s.company.id, m)).toMatchObject({ cls: "OTHER", via: "none" });
      expect(calls).toHaveLength(0);
      // An auto-send sequence step is queued for a person's approval instead of being sent.
      const x = await enrollment("pat6@prospect.test");
      await db().crmCadenceEnrollment.update({ where: { id: x.e.id }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
      await runCadences();
      const msg = await db().crmOutreachMessage.findFirstOrThrow({ where: { enrollmentId: x.e.id } });
      expect(msg.status).toBe("PENDING_APPROVAL");
      expect(msg.approvedAt).toBeNull();
    } finally {
      await db().autonomySettings.update({ where: { companyId: s.company.id }, data: { paused: false } });
    }
  });
});

describe("deal win probability", () => {
  it("is computed from closed deals and stored with its factors", async () => {
    const pipeline = await db().crmPipeline.create({ data: { organizationId: s.org.id, companyId: s.company.id, name: "G3 Sales", staleDays: 30 } });
    const stages = await Promise.all([
      db().crmPipelineStage.create({ data: { organizationId: s.org.id, companyId: s.company.id, pipelineId: pipeline.id, name: "Demo", position: 0, probability: 30 } }),
      db().crmPipelineStage.create({ data: { organizationId: s.org.id, companyId: s.company.id, pipelineId: pipeline.id, name: "Won", position: 1, probability: 100, type: "WON" } }),
    ]);
    const demo = stages[0];
    const base = { organizationId: s.org.id, companyId: s.company.id, pipelineId: pipeline.id, stageId: demo.id, currency: "EUR", createdById: s.owner.user.id };
    for (let i = 0; i < 10; i++) await db().crmDeal.create({ data: { ...base, name: `Closed ${i}`, status: i < 8 ? "WON" : "LOST", closedAt: new Date(), amountMinor: 100_000n } });
    const open = await db().crmDeal.create({ data: { ...base, name: "Open deal", amountMinor: 100_000n } });
    expect(await refreshCompanyWinProbabilities(s.org.id, s.company.id)).toBe(1);
    const d = await db().crmDeal.findUniqueOrThrow({ where: { id: open.id } });
    // base: (8 + 5·0.30) / (10 + 5) = 63 %, no activity yet: −5.
    expect(d.predictedProbability).toBe(58);
    expect((d.predictedFactors as { factors: { key: string; delta: number }[] }).factors.map((f) => f.key)).toEqual(["base", "stage_age", "activity", "overdue", "amount", "owner"]);
  });
});

describe("reply routing on comms.email.received", () => {
  it("routes a reply from an enrolled person once, right away", async () => {
    const cadence = await db().crmCadence.create({ data: { organizationId: s.org.id, companyId: s.company.id, name: "Seq event", status: "ACTIVE", createdById: s.owner.user.id } });
    await db().crmCadenceStep.create({ data: { organizationId: s.org.id, companyId: s.company.id, cadenceId: cadence.id, position: 0, delayDays: 2, subject: "Hi", body: "Hello" } });
    const e = await db().crmCadenceEnrollment.create({ data: { organizationId: s.org.id, companyId: s.company.id, cadenceId: cadence.id, toEmail: "kim@prospect.test", name: "Kim", enrolledById: s.owner.user.id, nextRunAt: new Date(Date.now() + 86_400_000), createdAt: new Date(Date.now() - 86_400_000) } });
    await inboundMail({ from: "Kim <kim@prospect.test>", subject: "Re: Hi", body: "No thanks, we already have a provider." });
    scripted({ class: "NOT_INTERESTED", summary: "Already has a provider.", return_date: "", referral_name: "", referral_email: "" });
    const { repliesOnEmail } = await import("@/server/modules/crm/replies");
    expect(await repliesOnEmail(s.org.id, s.company.id, "kim@prospect.test")).toBe(1);
    expect(await repliesOnEmail(s.org.id, s.company.id, "kim@prospect.test")).toBe(0);
    expect(calls).toHaveLength(1);
    expect(await db().crmCadenceEnrollment.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ status: "REPLIED", replyClass: "NOT_INTERESTED" });
  });
});
