import { z } from "zod";
import { db, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { forbidden } from "@/server/core/errors";
import { BUSINESS_MODELS, RUN_MODES } from "./brief";
import { blueprintInput, workforceInput } from "./steps";

/**
 * The onboarding journey: six stages that take a new founder from an empty account to a running company without ever
 * landing on an empty dashboard — welcome → vision → intelligence (real AI research) → company blueprint (edited and
 * approved) → AI workforce (hired) → launch into the Command Center. Progress, the current stage and unsubmitted answers
 * are stored per user (BuilderOnboarding) so a reload, another device or a returning founder resumes exactly there.
 */

export const JOURNEY = ["welcome", "vision", "intelligence", "blueprint", "workforce", "launch"] as const;
export type JourneyStage = (typeof JOURNEY)[number];
export const isJourneyStage = (v: unknown): v is JourneyStage => typeof v === "string" && (JOURNEY as readonly string[]).includes(v);

const str = (max: number) => z.string().trim().max(max).optional();

/** Vision answers saved before the company exists (validated again when the company and run are created). */
export const visionDraftSchema = z.object({
  mode: z.enum(RUN_MODES).optional(),
  idea: str(4000),
  name: str(120),
  industry: str(120),
  countryCode: z.string().regex(/^[A-Z]{2}$/).optional().or(z.literal("")),
  currency: z.string().regex(/^[A-Z]{3}$/).optional().or(z.literal("")),
  websiteUrl: str(500),
  targetMarket: str(1000),
  businessModel: z.enum(BUSINESS_MODELS).optional().or(z.literal("")),
  goals: str(2000),
  budgetAmount: str(20),
});
export type VisionDraft = z.infer<typeof visionDraftSchema>;

export const journeyDraftSchema = z.object({
  vision: visionDraftSchema.optional(),
  blueprint: z.object({ runId: z.string().uuid(), value: blueprintInput }).optional(),
  workforce: z.object({ runId: z.string().uuid(), value: workforceInput }).optional(),
});
export type JourneyDraft = z.infer<typeof journeyDraftSchema>;

export const progressInput = z.object({
  journeyStage: z.enum(JOURNEY).optional(),
  runId: z.string().uuid().nullable().optional(),
  completed: z.boolean().optional(),
  /** Replaces the given draft parts (others are kept); null clears that part. */
  draft: z
    .object({
      vision: visionDraftSchema.nullable().optional(),
      blueprint: journeyDraftSchema.shape.blueprint.unwrap().nullable().optional(),
      workforce: journeyDraftSchema.shape.workforce.unwrap().nullable().optional(),
    })
    .optional(),
});

function userOf(ctx: RequestContext) {
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw forbidden("Only users have an onboarding journey");
  return ctx.actor.id;
}

/** Saved draft parts that still validate (older or tampered values are dropped, never trusted). */
export function readDraft(raw: unknown): JourneyDraft {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: JourneyDraft = {};
  for (const key of ["vision", "blueprint", "workforce"] as const) {
    const r = journeyDraftSchema.shape[key].safeParse(o[key]);
    if (r.success && r.data) (out as Record<string, unknown>)[key] = r.data;
  }
  return out;
}

export async function getProgress(ctx: RequestContext) {
  const row = await db().builderOnboarding.findUnique({ where: { userId: userOf(ctx) } });
  return row ? { ...row, draft: readDraft(row.draft) } : null;
}

/** Save where the user is; draft parts are merged; a run must be one the user started. */
export async function saveProgress(ctx: RequestContext, raw: z.input<typeof progressInput>) {
  const input = progressInput.parse(raw);
  const userId = userOf(ctx);
  if (input.runId && !(await db().builderRun.findFirst({ where: { id: input.runId, createdById: userId }, select: { id: true } }))) throw forbidden("Not your builder run");
  const current = await db().builderOnboarding.findUnique({ where: { userId } });
  const draft: Record<string, unknown> = { ...readDraft(current?.draft) };
  for (const [k, v] of Object.entries(input.draft ?? {})) {
    if (v === null) delete draft[k];
    else if (v !== undefined) draft[k] = v;
  }
  const data = {
    ...(input.journeyStage !== undefined ? { journeyStage: input.journeyStage } : {}),
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.completed !== undefined ? { completedAt: input.completed ? new Date() : null } : {}),
    draft: draft as Prisma.InputJsonValue,
  };
  const row = await db().builderOnboarding.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  return { journeyStage: row.journeyStage, runId: row.runId, completedAt: row.completedAt, updatedAt: row.updatedAt };
}

/**
 * Where a signed-in user should start: `"/onboarding"` while they have no organization, no company, or an unfinished
 * journey run; null once the journey was completed (returning users and invited members never repeat it).
 * For the app's entry points (Command Center, post-sign-in) — relative to the locale.
 */
export async function journeyEntry(userId: string, organizationId: string | null, companyCount: number): Promise<"/onboarding" | null> {
  if (!organizationId || companyCount === 0) return "/onboarding";
  const row = await db().builderOnboarding.findUnique({ where: { userId }, select: { completedAt: true, runId: true } });
  if (!row || row.completedAt || !row.runId) return null;
  const run = await db().builderRun.findFirst({ where: { id: row.runId, organizationId, journey: true }, select: { status: true } });
  return run && run.status !== "CANCELLED" ? "/onboarding" : null;
}
