import "server-only";
import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, notFound } from "@/server/core/errors";
import { toJson } from "@/server/core/json";
import { writeAudit } from "@/server/modules/audit/service";
import { can } from "@/server/modules/rbac/service";
import { decideApproval } from "@/server/modules/approvals/service";
import { checkLimit } from "@/server/modules/entitlements/service";
import { commandSuggestions, liveCommandRuns, runCommand } from "@/server/modules/guide/command";
import { authorizeVoice, isUuid, readSettings, type VoiceScope } from "./access";
import { CONFIRM_WORDS, isVoiceLanguage, personalityOf, type VoiceLanguage } from "./catalog";
import { connectedSpeechProviders } from "./speech";
import { answerDirect, assistantRefusal, classifyUtterance, gatherBriefing, liveWorkerState, type Briefing, type TurnContext } from "./converse";
import { dispatchReplyKey, heuristicIntent, replyLanguage, type VoiceIntent, type WorkerState } from "./intent";

/**
 * Voice OS conversations. Each utterance is routed first (voiceos/converse.ts): conversation and questions about the
 * company are answered directly in the request, grounded in live data; requests for work become a real AI Command
 * (guide/command.ts runCommand) in the session's command session, and acknowledgements and answers are derived from
 * the stored run, its steps, agent tasks and approvals — honest about a missing background worker.
 * Transcripts are written (VoiceosTurn) only while the person has history enabled.
 */

type Json = Parameters<typeof toJson>[0];

async function ownedSession(scope: VoiceScope, userId: string, sessionId: string) {
  if (!isUuid(sessionId)) throw notFound("Voice session");
  const s = await db().voiceosSession.findFirst({ where: { ...scope, id: sessionId, userId } });
  if (!s) throw notFound("Voice session");
  return s;
}

async function writeTurn(
  scope: VoiceScope,
  sessionId: string,
  turn: { role: "USER" | "ASSISTANT"; kind: "UTTERANCE" | "ACK" | "ANSWER" | "DECISION" | "NOTICE"; text?: string | null; replyKey?: string | null; params?: Record<string, unknown>; inputMode?: string | null; provider?: string | null; commandRunId?: string | null; approvalId?: string | null },
) {
  try {
    await db().voiceosTurn.create({
      data: {
        ...scope,
        sessionId,
        role: turn.role,
        kind: turn.kind,
        text: turn.text?.slice(0, 8000) ?? null,
        replyKey: turn.replyKey ?? null,
        params: toJson((turn.params ?? {}) as Json),
        inputMode: turn.inputMode ?? null,
        provider: turn.provider ?? null,
        commandRunId: turn.commandRunId ?? null,
        approvalId: turn.approvalId ?? null,
      },
    });
  } catch (err) {
    // The unique (session, run, kind) keeps one answer per run; a concurrent duplicate is fine.
    if ((err as { code?: string }).code !== "P2002") throw err;
  }
}

// ───────────── Bootstrap ─────────────

/** Everything the console and dock need to start: preferences, providers, AI readiness, minutes, live runs. */
export async function voiceBootstrap(ctx: RequestContext, organizationId: string, companyId: string, locale?: string) {
  const { chain, userId } = await authorizeVoice(ctx, organizationId, companyId);
  const scope = { organizationId, companyId };
  const [settings, providers, suggestions, canDecide, canManageIntegrations, minutes, runs, sessions] = await Promise.all([
    readSettings(scope, userId, locale),
    connectedSpeechProviders(scope),
    commandSuggestions(ctx, organizationId, companyId),
    can(ctx, "approvals.decide", chain),
    can(ctx, "integrations.manage", chain),
    checkLimit(organizationId, "voice.assistant.minutes.month", 0),
    liveCommandRuns(ctx, organizationId, companyId, 8),
    db().voiceosSession.findMany({
      where: { ...scope, userId },
      orderBy: { lastActivityAt: "desc" },
      take: 12,
      select: { id: true, title: true, status: true, utterances: true, historyEnabled: true, lastActivityAt: true, createdAt: true, _count: { select: { turns: true } } },
    }),
  ]);
  return {
    settings,
    providers,
    suggestions: suggestions.suggestions,
    ai: suggestions.ai,
    canDecide,
    canManageIntegrations,
    minutes: { used: minutes.used, limit: minutes.limit, allowed: minutes.allowed || minutes.limit === null || minutes.used < minutes.limit },
    runs,
    sessions: sessions.map((s) => ({ id: s.id, title: s.title, status: s.status, utterances: s.utterances, turns: s._count.turns, lastActivityAt: s.lastActivityAt, createdAt: s.createdAt })),
  };
}
export type VoiceBootstrap = Awaited<ReturnType<typeof voiceBootstrap>>;

// ───────────── Sessions ─────────────

export const startSessionInput = z.object({ language: z.string().max(10).optional(), personality: z.string().max(32).optional() });

export async function startVoiceSession(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof startSessionInput>) {
  const input = startSessionInput.parse(raw);
  const { userId } = await authorizeVoice(ctx, organizationId, companyId);
  const scope = { organizationId, companyId };
  const settings = await readSettings(scope, userId);
  const language: VoiceLanguage = isVoiceLanguage(input.language) ? input.language : settings.language;
  return transaction(async (tx) => {
    // One active conversation per person and company: older ones end when a new one starts.
    await tx.voiceosSession.updateMany({ where: { ...scope, userId, status: "ACTIVE" }, data: { status: "ENDED", endedAt: new Date() } });
    const s = await tx.voiceosSession.create({
      data: { ...scope, userId, language, personality: personalityOf(input.personality ?? settings.personality).key, historyEnabled: settings.historyEnabled },
      select: { id: true, language: true, personality: true, historyEnabled: true, commandSessionId: true, createdAt: true },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voiceos.session.started", resourceType: "voiceos_session", resourceId: s.id, newValue: { companyId, language, history: settings.historyEnabled } });
    return s;
  });
}

export async function endVoiceSession(ctx: RequestContext, organizationId: string, companyId: string, sessionId: string) {
  const { userId } = await authorizeVoice(ctx, organizationId, companyId);
  const s = await ownedSession({ organizationId, companyId }, userId, sessionId);
  await db().voiceosSession.updateMany({ where: { id: s.id, status: "ACTIVE" }, data: { status: "ENDED", endedAt: new Date() } });
  return { ok: true };
}

/** One conversation with its stored turns (empty when history was off). */
export async function getVoiceSession(ctx: RequestContext, organizationId: string, companyId: string, sessionId: string) {
  const { userId } = await authorizeVoice(ctx, organizationId, companyId);
  const s = await ownedSession({ organizationId, companyId }, userId, sessionId);
  const turns = await db().voiceosTurn.findMany({
    where: { organizationId, companyId, sessionId: s.id },
    orderBy: { createdAt: "asc" },
    take: 300,
    select: { id: true, role: true, kind: true, text: true, replyKey: true, params: true, inputMode: true, provider: true, commandRunId: true, approvalId: true, createdAt: true },
  });
  return {
    id: s.id,
    status: s.status,
    title: s.title,
    language: s.language,
    personality: s.personality,
    commandSessionId: s.commandSessionId,
    sttSeconds: s.sttSeconds,
    ttsSeconds: s.ttsSeconds,
    utterances: s.utterances,
    createdAt: s.createdAt,
    lastActivityAt: s.lastActivityAt,
    turns,
  };
}

export async function deleteVoiceSession(ctx: RequestContext, organizationId: string, companyId: string, sessionId: string) {
  const { userId } = await authorizeVoice(ctx, organizationId, companyId);
  return transaction(async (tx) => {
    if (!isUuid(sessionId)) throw notFound("Voice session");
    const s = await tx.voiceosSession.findFirst({ where: { organizationId, companyId, id: sessionId, userId }, select: { id: true } });
    if (!s) throw notFound("Voice session");
    await tx.voiceosSession.delete({ where: { id: s.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voiceos.session.deleted", resourceType: "voiceos_session", resourceId: s.id });
    return { ok: true };
  });
}

/** Erase every stored voice transcript of the viewer in this company (sessions keep their usage counters). */
export async function clearVoiceHistory(ctx: RequestContext, organizationId: string, companyId: string) {
  const { userId } = await authorizeVoice(ctx, organizationId, companyId);
  return transaction(async (tx) => {
    const ids = (await tx.voiceosSession.findMany({ where: { organizationId, companyId, userId }, select: { id: true } })).map((s) => s.id);
    const { count } = ids.length ? await tx.voiceosTurn.deleteMany({ where: { organizationId, companyId, sessionId: { in: ids } } }) : { count: 0 };
    await tx.voiceosSession.updateMany({ where: { organizationId, companyId, userId }, data: { title: null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voiceos.history.cleared", resourceType: "voiceos_session", resourceId: null, newValue: { companyId, turns: count } });
    return { ok: true, deleted: count };
  });
}

// ───────────── Utterances → direct answer or AI Command ─────────────

export const utterInput = z.object({
  text: z.string().trim().min(2).max(2000),
  inputMode: z.enum(["voice", "text", "wake"]).default("voice"),
  /** Speech provider that produced the transcript (openai, elevenlabs, deepgram, browser), for the stored turn. */
  provider: z.string().max(20).optional(),
  /** Browser path the person was on (page context for the command). */
  path: z.string().max(400).optional(),
  /** The last turns of this conversation as the console shows them (short multi-turn context; never stored). */
  context: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(600) }))
    .max(12)
    .optional(),
});

const OPEN = new Set(["PLANNED", "RUNNING", "REVIEWING"]);
const CONTEXT_TURNS = 6;

/** Facts for the spoken status line the client builds when no AI answer is possible (-1 = not visible). */
function statusParams(b: Briefing | null, reason: string): Record<string, string | number> {
  const n = (v: number | null | undefined) => (typeof v === "number" ? v : -1);
  return {
    reason,
    running: n(b?.facts.running),
    queued: n(b?.facts.queued),
    failed: n(b?.facts.failed24h),
    approvals: n(b?.facts.approvals),
    myTasksDue: n(b?.facts.myTasksDue),
    meetingsToday: n(b?.facts.meetingsToday),
    worker: b?.facts.worker ?? "missing",
  };
}

export interface UtterReply {
  /** jarvis.reply.* key the client voices; "answer" carries its own text. */
  key: string;
  params: Record<string, string | number>;
  /** Direct answer text (key "answer"). */
  text?: string;
  /** Language the text is in (speech voice), when it differs from the session's. */
  language?: string;
}

/**
 * Route one utterance. Conversation and company questions are answered in the request: one grounded model call over
 * live data the viewer may read (a factual status line when AI is unavailable). Requests for work become a real AI
 * Command run delegated to AI employees, and the reply says honestly when the background worker is not running, so
 * the work is only queued.
 */
export async function utter(ctx: RequestContext, organizationId: string, companyId: string, sessionId: string, raw: z.input<typeof utterInput>) {
  const started = Date.now();
  const input = utterInput.parse(raw);
  const scope = { organizationId, companyId };
  const { chain, userId } = await authorizeVoice(ctx, organizationId, companyId);
  const session = await ownedSession(scope, userId, sessionId);
  if (session.status !== "ACTIVE") throw new AppError("conflict", "This voice session has ended", { reason: "voiceos_session_ended" });
  const settings = await readSettings(scope, userId);
  const context: TurnContext[] = (input.context ?? []).slice(-CONTEXT_TURNS);
  const language = replyLanguage(input.text, session.language);

  const refusal = await assistantRefusal(organizationId);
  // Gather the live facts while the classifier runs, unless the words clearly ask for work.
  let briefing: Promise<Briefing | null> | null = null;
  const brief = () => (briefing ??= gatherBriefing(ctx, scope, chain, userId, session.language).catch(() => null));
  if (heuristicIntent(input.text) !== "work_request") void brief();
  const routed = await classifyUtterance(scope, session.id, userId, input.text, context, refusal);

  const touch = (extra: Record<string, unknown> = {}) =>
    db().voiceosSession.update({
      where: { id: session.id },
      data: { utterances: { increment: 1 }, lastActivityAt: new Date(), ...(settings.historyEnabled && !session.title ? { title: input.text.slice(0, 120) } : {}), ...extra },
    });

  if (routed.intent !== "work_request") {
    const facts = await brief();
    let reply: UtterReply;
    if (refusal || !facts) {
      reply = { key: routed.intent === "conversation" ? "statusHello" : "status", params: statusParams(facts, refusal ?? "data_unavailable") };
    } else {
      try {
        const viewer = await db().user.findUnique({ where: { id: userId }, select: { name: true } });
        const answer = await answerDirect(scope, session.id, userId, { text: input.text, context, intent: routed.intent, briefing: facts, language, viewerName: viewer?.name ?? null });
        reply = { key: "answer", params: {}, text: answer.text, language: answer.language.code };
      } catch {
        // The failure is recorded for Admin; the person still gets the real numbers, never an invented answer.
        reply = { key: routed.intent === "conversation" ? "statusHello" : "status", params: statusParams(facts, "ai_failed") };
      }
    }
    await touch();
    if (settings.historyEnabled) {
      await writeTurn(scope, session.id, { role: "USER", kind: "UTTERANCE", text: input.text, inputMode: input.inputMode, provider: input.provider ?? null, params: { intent: routed.intent, via: routed.via } });
      await writeTurn(scope, session.id, reply.key === "answer" ? { role: "ASSISTANT", kind: "ANSWER", text: reply.text } : { role: "ASSISTANT", kind: "NOTICE", replyKey: reply.key, params: reply.params });
    }
    return { commandSessionId: session.commandSessionId, intent: routed.intent as VoiceIntent, routedBy: routed.via, run: null, reply, open: false, worker: facts?.facts.worker ?? null, latencyMs: Date.now() - started };
  }

  // Work: a real AI Command run. Check the background worker first, so the reply never promises what cannot happen.
  const worker: WorkerState = await liveWorkerState();
  const view = await runCommand(ctx, organizationId, companyId, {
    text: input.text,
    sessionId: session.commandSessionId ?? undefined,
    locale: session.language,
    path: input.path,
  });
  const run = view.runs[view.runs.length - 1];
  await touch({ commandSessionId: view.id });
  const steps = run?.steps ?? [];
  const delegated = steps.filter((s) => s.status === "DELEGATED");
  const blocked = steps.filter((s) => s.status === "BLOCKED");
  const profiles = [...new Set(steps.filter((s) => s.kind !== "REVIEW").map((s) => s.profile))];
  const outcome = !run ? "failed" : delegated.length ? "delegated" : blocked.length ? "blocked" : "planned";
  const reply: UtterReply = {
    key: dispatchReplyKey(outcome, worker),
    params: outcome === "blocked" ? { reason: blocked[0]!.errorReason ?? "unknown" } : outcome === "failed" ? {} : { profiles: profiles.join(","), count: profiles.length || steps.length, worker },
  };
  if (settings.historyEnabled) {
    await writeTurn(scope, session.id, { role: "USER", kind: "UTTERANCE", text: input.text, inputMode: input.inputMode, provider: input.provider ?? null, commandRunId: run?.id ?? null, params: { intent: routed.intent, via: routed.via } });
    await writeTurn(scope, session.id, { role: "ASSISTANT", kind: "ACK", replyKey: reply.key, params: reply.params, commandRunId: run?.id ?? null });
  }
  return {
    commandSessionId: view.id,
    intent: routed.intent as VoiceIntent,
    routedBy: routed.via,
    run: run
      ? { id: run.id, status: run.status, stages: run.stages, intents: run.understanding.intents.map((i) => i.key), profiles, steps: steps.map((s) => ({ id: s.id, kind: s.kind, profile: s.profile, status: s.status, errorReason: s.errorReason })) }
      : null,
    reply,
    open: run ? OPEN.has(run.status) : false,
    worker,
    latencyMs: Date.now() - started,
  };
}

// ───────────── Following a run ─────────────

/** Markdown → plain text for speech and transcripts. */
export function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_`>|]/g, "")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** First sentences up to ~`max` characters, cut at a sentence end where possible. */
export function spokenSummary(text: string, max = 480): string {
  const flat = text.replace(/\n+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.lastIndexOf("。"), cut.lastIndexOf("।"), cut.lastIndexOf("؟ "));
  return (end > max * 0.4 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`).trim();
}

/** Task ids (steps and their delegated children) of every run in the voice session's command session. */
async function sessionTaskIds(scope: VoiceScope, commandSessionId: string | null, runId?: string) {
  if (!commandSessionId) return [];
  const steps = await db().commandPlanStep.findMany({
    where: { ...scope, run: { sessionId: commandSessionId, ...(runId ? { id: runId } : {}) }, taskId: { not: null } },
    select: { taskId: true },
  });
  const ids = steps.map((s) => s.taskId!).filter(Boolean);
  if (!ids.length) return [];
  const kids = await db().agentTask.findMany({ where: { ...scope, parentTaskId: { in: ids } }, select: { id: true } });
  return [...ids, ...kids.map((k) => k.id)];
}

/**
 * Live state of one run started from this voice session: stages, the answer once complete (review step, else the
 * last completed department step), and approvals still waiting for a decision. The answer is stored as a turn once
 * (history on).
 */
export async function followRun(ctx: RequestContext, organizationId: string, companyId: string, sessionId: string, runId: string) {
  const scope = { organizationId, companyId };
  const { chain, userId } = await authorizeVoice(ctx, organizationId, companyId);
  const session = await ownedSession(scope, userId, sessionId);
  if (!isUuid(runId) || !session.commandSessionId) throw notFound("Command run");
  const run = await db().commandRun.findFirst({
    where: { ...scope, id: runId, sessionId: session.commandSessionId, userId },
    select: { id: true, status: true, nextAction: true, completedAt: true, steps: { orderBy: { position: "asc" }, select: { kind: true, status: true, profile: true, taskId: true, errorReason: true } } },
  });
  if (!run) throw notFound("Command run");
  const taskIds = await sessionTaskIds(scope, session.commandSessionId, run.id);
  const [tasks, approvals, canDecide] = await Promise.all([
    taskIds.length ? db().agentTask.findMany({ where: { ...scope, id: { in: taskIds } }, select: { id: true, status: true, output: true, profile: true, errorCode: true } }) : [],
    taskIds.length
      ? db().approval.findMany({ where: { ...scope, taskId: { in: taskIds }, status: "PENDING", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "asc" }, select: { id: true, tool: true, summary: true, risk: true, taskId: true, createdAt: true } })
      : [],
    can(ctx, "approvals.decide", chain),
  ]);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const done = (taskId: string | null) => (taskId ? byId.get(taskId) : undefined);
  const review = run.steps.find((s) => s.kind === "REVIEW");
  const reviewTask = done(review?.taskId ?? null);
  const lastDept = [...run.steps].reverse().find((s) => s.kind !== "REVIEW" && done(s.taskId)?.status === "COMPLETED" && done(s.taskId)?.output);
  const source = reviewTask?.status === "COMPLETED" && reviewTask.output ? reviewTask.output : lastDept ? done(lastDept.taskId)!.output! : null;
  const answer = run.status === "COMPLETED" && source ? plainText(source).slice(0, 4000) : null;
  const running = tasks.filter((t) => t.status === "RUNNING" || t.status === "QUEUED").length;
  const settings = await readSettings(scope, userId);
  if (settings.historyEnabled && answer) await writeTurn(scope, session.id, { role: "ASSISTANT", kind: "ANSWER", text: answer, commandRunId: run.id });
  if (settings.historyEnabled && run.status === "FAILED") await writeTurn(scope, session.id, { role: "ASSISTANT", kind: "NOTICE", replyKey: "failed", commandRunId: run.id });
  return {
    id: run.id,
    status: run.status as string,
    open: OPEN.has(run.status),
    running,
    answer,
    spoken: answer ? spokenSummary(answer) : null,
    nextAction: run.nextAction,
    failedReason: run.status === "FAILED" ? (run.steps.find((s) => s.errorReason)?.errorReason ?? tasks.find((t) => t.errorCode)?.errorCode ?? null) : null,
    canDecide,
    approvals: approvals.map((a) => ({ id: a.id, tool: a.tool, summary: a.summary, risk: a.risk as string, createdAt: a.createdAt })),
  };
}

// ───────────── Confirmations ─────────────

export const confirmInput = z.object({
  approvalId: z.string().uuid(),
  /** "text": a typed reply in the console, read exactly like a spoken one. */
  via: z.enum(["voice", "text", "click"]),
  /** Clicked decision. */
  decision: z.enum(["approve", "reject"]).optional(),
  /** Spoken or typed reply (via "voice" / "text"): must be a short, explicit yes/approve or no/reject phrase. */
  text: z.string().trim().max(200).optional(),
});

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.,!?;:"'“”‘’。，！？؟،।]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Read an explicit decision from a short spoken reply. Anything long, mixed ("yes… no") or unrelated is "unclear":
 * high-impact actions are never approved on an ambiguous utterance.
 */
export function parseSpokenDecision(text: string, language: string): "approve" | "reject" | "unclear" {
  const lang: VoiceLanguage = isVoiceLanguage(language) ? language : "en-US";
  const said = normalize(text);
  if (!said) return "unclear";
  const words = said.split(" ");
  const pools = [CONFIRM_WORDS[lang], lang === "en-US" ? null : CONFIRM_WORDS["en-US"]].filter((p): p is (typeof CONFIRM_WORDS)["en-US"] => !!p);
  const yesPhrases = pools.flatMap((p) => p.yes).map(normalize);
  const noPhrases = pools.flatMap((p) => p.no).map(normalize);
  if (noPhrases.includes(said)) return "reject";
  if (yesPhrases.includes(said)) return "approve";
  if (words.length > 5) return "unclear";
  // Scripts without spaces (zh) match by substring; others by whole words/phrases.
  const has = (p: string) => (lang === "zh-CN" ? said.includes(p) : ` ${said} `.includes(` ${p} `));
  const yes = yesPhrases.some(has);
  const no = noPhrases.some(has);
  if (yes && !no) return "approve";
  if (no && !yes) return "reject";
  return "unclear";
}

/**
 * Approve or reject a pending approval raised by this voice session's work — clicked, or confirmed with an explicit
 * spoken phrase. Uses the regular approval decision (permissions, MFA for high risk, founder-only rules, execution).
 */
export async function confirmApproval(ctx: RequestContext, organizationId: string, companyId: string, sessionId: string, raw: z.input<typeof confirmInput>) {
  const input = confirmInput.parse(raw);
  const scope = { organizationId, companyId };
  const { userId } = await authorizeVoice(ctx, organizationId, companyId);
  const session = await ownedSession(scope, userId, sessionId);
  const decision = input.via === "click" ? input.decision : parseSpokenDecision(input.text ?? "", session.language);
  if (!decision) throw new AppError("validation_error", "A decision is required");
  if (decision === "unclear") return { outcome: "unclear" as const, approvalId: input.approvalId };
  const taskIds = await sessionTaskIds(scope, session.commandSessionId);
  const approval = taskIds.length ? await db().approval.findFirst({ where: { ...scope, id: input.approvalId, taskId: { in: taskIds } }, select: { id: true, tool: true } }) : null;
  if (!approval) throw notFound("Approval");
  const note = input.via === "voice" ? `Confirmed by voice in Realy: "${(input.text ?? "").slice(0, 120)}"` : input.via === "text" ? `Confirmed in Realy by typed reply: "${(input.text ?? "").slice(0, 120)}"` : "Decided in Realy";
  const result = await decideApproval(ctx, organizationId, companyId, approval.id, { decision, note });
  await transaction(async (tx) => {
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voiceos.approval.decided", resourceType: "approval", resourceId: approval.id, newValue: { via: input.via, decision, tool: approval.tool, sessionId: session.id } });
  });
  const settings = await readSettings(scope, userId);
  if (settings.historyEnabled) {
    if (input.via !== "click" && input.text) await writeTurn(scope, session.id, { role: "USER", kind: "UTTERANCE", text: input.text, inputMode: input.via, approvalId: approval.id });
    await writeTurn(scope, session.id, { role: "ASSISTANT", kind: "DECISION", replyKey: decision === "approve" ? "approved" : "rejected", params: { status: result.status }, approvalId: approval.id });
  }
  return { outcome: decision, approvalId: approval.id, status: result.status as string };
}
