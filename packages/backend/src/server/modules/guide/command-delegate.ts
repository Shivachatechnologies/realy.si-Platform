import "server-only";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { writeAudit } from "@/server/modules/audit/service";
import { profileByKey } from "@/server/modules/agents/profiles";
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from "@/i18n/config";
import { getT } from "@/i18n/server";
import type { CommandRunOrigin } from "@/generated/prisma/enums";
import { COMMAND_INTENTS } from "./command";
import { startRun } from "./command-run";

/**
 * Delegated command runs: work the AI CEO (or a founder acting on an objective initiative) hands to one department's
 * AI employee through the normal AI Command pipeline — persisted plan, real agent tasks, review, Brain synthesis.
 * Runs live in the acting member's "Delegated work" command session so they can be followed in AI Command too.
 */

type Scope = { organizationId: string; companyId: string };

/** The intent key (guide.command.intents.*) whose department owns a profile; "fallback" for the AI CEO and others. */
export function intentForProfile(profile: string): string {
  return COMMAND_INTENTS.find((i) => i.profile === profile)?.key ?? "fallback";
}

/** The acting member's delegated-work session (created on first use; found through its earlier delegated runs). */
async function delegatedSession(scope: Scope, userId: string, locale: AppLocale) {
  const prior = await db().commandRun.findFirst({ where: { ...scope, userId, origin: "CEO" }, orderBy: { createdAt: "desc" }, select: { sessionId: true } });
  if (prior) return prior.sessionId;
  const t = await getT(locale);
  const s = await db().commandSession.create({ data: { ...scope, userId, title: t("command.ceo.sessionTitle").slice(0, 120) }, select: { id: true } });
  return s.id;
}

export interface DelegatedRunInput {
  userId: string;
  /** The directive (shown as the command; also the run's text). */
  text: string;
  profile: string;
  /** Why (real evidence); goes into every step's instructions. */
  brief: string;
  origin: CommandRunOrigin;
  priorityId?: string | null;
  objectiveId?: string | null;
  parentRunId?: string | null;
  locale?: string | null;
}

/** Start one delegated command run; returns its id. Throws when the profile is unavailable. */
export async function startDelegatedRun(ctx: RequestContext, scope: Scope, input: DelegatedRunInput): Promise<{ runId: string; sessionId: string }> {
  const profile = profileByKey(input.profile) ? input.profile : profileByKey("ai_ceo") ? "ai_ceo" : "research_analyst";
  const locale: AppLocale = isAppLocale(input.locale) ? input.locale : DEFAULT_LOCALE;
  const sessionId = await delegatedSession(scope, input.userId, locale);
  const text = input.text.slice(0, 2000);
  const message = await transaction(async (tx) => {
    await tx.commandSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
    const m = await tx.commandMessage.create({ data: { ...scope, sessionId, role: "USER", content: text, intent: intentForProfile(profile), profile }, select: { id: true } });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId: scope.organizationId,
      action: "guide.command.delegated",
      resourceType: "command_session",
      resourceId: sessionId,
      newValue: { companyId: scope.companyId, origin: input.origin, profile, priorityId: input.priorityId ?? null, objectiveId: input.objectiveId ?? null },
    });
    return m;
  });
  const runId = await startRun(ctx, scope, {
    sessionId,
    messageId: message.id,
    userId: input.userId,
    text,
    locale,
    intents: [{ key: intentForProfile(profile), profile, score: 1 }],
    facts: {},
    page: null,
    origin: input.origin,
    priorityId: input.priorityId ?? null,
    objectiveId: input.objectiveId ?? null,
    parentRunId: input.parentRunId ?? null,
    brief: input.brief,
  });
  return { runId, sessionId };
}
