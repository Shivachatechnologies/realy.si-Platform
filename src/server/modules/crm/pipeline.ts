import type { LeadStage } from "@/generated/prisma/enums";

/** Default win probability per stage, used when a lead has no explicit probability. */
export const STAGE_PROBABILITY: Record<LeadStage, number> = { NEW: 10, CONTACTED: 20, QUALIFIED: 40, PROPOSAL: 60, WON: 100, LOST: 0 };

export const effectiveProbability = (l: { probability: number | null; stage: LeadStage }) => l.probability ?? STAGE_PROBABILITY[l.stage];

/** Deal value × probability, in minor units (integer arithmetic, rounded down). */
export const weightedMinor = (l: { valueMinor: bigint | null; probability: number | null; stage: LeadStage }) =>
  l.valueMinor == null ? 0n : (l.valueMinor * BigInt(effectiveProbability(l))) / 100n;

export const isOpenStage = (stage: LeadStage) => stage !== "WON" && stage !== "LOST";
