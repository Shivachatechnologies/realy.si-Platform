import { z } from "zod";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { forbidden } from "@/server/core/errors";
import type { RunMode } from "./brief";

/**
 * The onboarding journey: 10 plain-language stages. Stages 1–2 collect the setup and the founder's answers; stages
 * 3–9 each show the builder steps (and their real records) that belong to them; stage 10 hands over to the Command
 * Center. Progress is stored per user so a returning founder lands where they left.
 */

export const JOURNEY = ["welcome", "tell", "vision", "market", "blueprint", "products", "workforce", "structure", "goals", "command"] as const;
export type JourneyStage = (typeof JOURNEY)[number];
export const SETUP_STEPS = ["profile", "workspace", "plan", "business", "questions"] as const;

/** Builder steps shown in each stage (by run mode). */
const EXISTING_STAGES: Partial<Record<JourneyStage, string[]>> = {
  vision: ["website_ingest", "business_analysis"],
  market: ["market_competitors", "opportunities_weaknesses"],
  blueprint: ["positioning_review"],
  products: ["business_analysis"],
  workforce: ["recommended_configuration"],
  structure: ["recommended_configuration"],
  goals: ["goals"],
};
const STAGE_STEPS: Record<RunMode, Partial<Record<JourneyStage, string[]>>> = {
  NEW_IDEA: {
    vision: ["idea_analysis"],
    market: ["market_research", "competitors", "demand", "customers_personas", "opportunities_risks"],
    blueprint: ["positioning", "business_plan", "brand"],
    products: ["business_model", "product_roadmap"],
    workforce: ["ai_employees"],
    structure: ["org_structure", "projects_tasks", "operational_workflows"],
    goals: ["objectives_kpis", "go_to_market", "launch_plan", "financial_plan"],
  },
  EXISTING: EXISTING_STAGES,
  IMPORT: EXISTING_STAGES,
};

export const stageSteps = (mode: RunMode, stage: JourneyStage): string[] => STAGE_STEPS[mode][stage] ?? [];

export const progressInput = z.object({
  stage: z.number().int().min(1).max(JOURNEY.length).optional(),
  wizardStep: z.enum(SETUP_STEPS).optional(),
  done: z.array(z.enum(SETUP_STEPS)).max(SETUP_STEPS.length).optional(),
  runId: z.string().uuid().nullable().optional(),
  completed: z.boolean().optional(),
});

function userOf(ctx: RequestContext) {
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw forbidden("Only users have an onboarding journey");
  return ctx.actor.id;
}

export async function getProgress(ctx: RequestContext) {
  return db().builderOnboarding.findUnique({ where: { userId: userOf(ctx) } });
}

/** Save where the user is; `done` is merged, a run must be one the user started. */
export async function saveProgress(ctx: RequestContext, raw: z.input<typeof progressInput>) {
  const input = progressInput.parse(raw);
  const userId = userOf(ctx);
  if (input.runId && !(await db().builderRun.findFirst({ where: { id: input.runId, createdById: userId }, select: { id: true } }))) throw forbidden("Not your builder run");
  const current = await db().builderOnboarding.findUnique({ where: { userId } });
  const done = [...new Set([...(current?.done ?? []), ...(input.done ?? [])])];
  const data = {
    ...(input.stage !== undefined ? { stage: input.stage } : {}),
    ...(input.wizardStep !== undefined ? { wizardStep: input.wizardStep } : {}),
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.completed !== undefined ? { completedAt: input.completed ? new Date() : null } : {}),
    done,
  };
  return db().builderOnboarding.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}
