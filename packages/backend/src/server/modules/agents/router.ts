import { providerOf, resolveTierModel, type RoutingTier } from "@/server/modules/admin/ai-models";
import { fallbackModels } from "@/server/modules/admin/ops";
import type { AgentProfile } from "./profiles";

/**
 * Model router (agents runtime). Each run is classified by complexity — the profile's class, how many tools it is
 * offered, how long the task is, task wording and explicit hints — into a tier that maps onto the admin routing table
 * (admin/ai-models.ts resolveTierModel: simple → cheap, standard → mid, complex → premium / class default; voice,
 * image and video resolve to specialized models for the modules that use them). Pinned models (explicit, the AI
 * employee's own, an organization override) always win. Provider errors fall back along the admin fallback chain and
 * one tier up; a circuit breaker per provider/model skips models that keep failing and probes them again later.
 */

export type ComplexityTier = "simple" | "standard" | "complex";
export interface RouteHints {
  /** Force a tier (e.g. a module knows its job is a short classification). */
  tier?: ComplexityTier;
}

const CLASS_WEIGHT: Record<string, number> = { executive: 1, research: 1, finance: 1, engineering: 1, product: 1, hr: 0, sales: 0, marketing: 0, operations: 0, support: -1 };
const COMPLEX_WORDS = /\b(strateg|analy[sz]|forecast|plan(?:ning)?\b|architect|negotiat|legal|contract|diagnos|root cause|reconcil|investigat|compare|evaluat|due diligence|model(?:ling|ing)?\b|budget)/i;
const SIMPLE_WORDS = /\b(summari[sz]|classif|translat|rewrite|extract|tag(?:s|ging)?\b|categori[sz]|format|proofread|shorten|headline|subject line|triage)/i;

export interface Classification {
  tier: ComplexityTier;
  score: number;
  reasons: string[];
}

/** Deterministic complexity classification of one run (no model call). */
export function classifyRun(input: { profile: Pick<AgentProfile, "key" | "department" | "maxTurns">; title: string; instructions: string; toolCount: number; hints?: RouteHints }): Classification {
  if (input.hints?.tier) return { tier: input.hints.tier, score: 0, reasons: ["hint"] };
  const reasons: string[] = [];
  let score = 0;
  const add = (n: number, reason: string) => {
    score += n;
    reasons.push(reason);
  };
  const w = CLASS_WEIGHT[input.profile.department ?? "operations"] ?? 0;
  if (w) add(w, `class:${input.profile.department}${w > 0 ? "+" : "-"}`);
  if (input.toolCount >= 12) add(1, "many_tools");
  else if (input.toolCount <= 3) add(-1, "few_tools");
  const size = input.title.length + input.instructions.length;
  if (size > 16_000) add(2, "very_long_input");
  else if (size > 4_000) add(1, "long_input");
  else if (size < 400) add(-1, "short_input");
  if (input.profile.maxTurns >= 15) add(1, "many_turns");
  const text = `${input.title}\n${input.instructions.slice(0, 4000)}`;
  if (COMPLEX_WORDS.test(text)) add(1, "reasoning_words");
  if (SIMPLE_WORDS.test(text)) add(-1, "simple_words");
  const tier: ComplexityTier = score <= -1 ? "simple" : score >= 2 ? "complex" : "standard";
  return { tier, score, reasons };
}

/** The model for a tier (admin table → built-in defaults → platform default). */
export async function modelForTier(organizationId: string, profileKey: string, tier: RoutingTier): Promise<string | null> {
  return resolveTierModel({ organizationId, profile: profileKey, tier });
}

/** Specialized model for voice / image / video work, for modules outside the agent runtime (null = module default). */
export const specializedModel = (organizationId: string, profileKey: string | null, tier: "voice" | "image" | "video") => resolveTierModel({ organizationId, profile: profileKey, tier });

const NEXT_TIER: Record<ComplexityTier, ComplexityTier | null> = { simple: "standard", standard: "complex", complex: null };

/** Ordered alternatives after `model` fails: the admin fallback chain, then the next tier's model. Distinct, max 3. */
export async function fallbackChain(organizationId: string, profileKey: string, model: string, tier: ComplexityTier): Promise<string[]> {
  const out: string[] = [];
  for (const m of await fallbackModels(model).catch(() => [] as string[])) if (!out.includes(m) && m !== model) out.push(m);
  let t = NEXT_TIER[tier];
  while (t && out.length < 3) {
    const m = await modelForTier(organizationId, profileKey, t).catch(() => null);
    if (m && m !== model && !out.includes(m)) out.push(m);
    t = NEXT_TIER[t];
  }
  return out.slice(0, 3);
}

// ───────────── Circuit breaker (per provider / model, per process) ─────────────

export const BREAKER_FAILURES = 4;
export const BREAKER_OPEN_MS = 60_000;
interface Breaker {
  failures: number;
  openedAt: number | null;
  probing: boolean;
}
const breakers = new Map<string, Breaker>();
const keyOf = (model: string) => `${providerOf(model)}:${model}`;

/** May a call go to this model now? Closed → yes; open → no until the cool-down ends, then one half-open probe. */
export function breakerAllows(model: string, now = Date.now()): boolean {
  const b = breakers.get(keyOf(model));
  if (!b || b.openedAt === null) return true;
  if (now - b.openedAt < BREAKER_OPEN_MS) return false;
  if (b.probing) return false;
  b.probing = true;
  return true;
}

export function breakerSuccess(model: string) {
  breakers.delete(keyOf(model));
}

export function breakerFailure(model: string, now = Date.now()) {
  const k = keyOf(model);
  const b = breakers.get(k) ?? { failures: 0, openedAt: null, probing: false };
  b.failures++;
  if (b.probing || b.failures >= BREAKER_FAILURES) {
    b.openedAt = now;
    b.probing = false;
  }
  breakers.set(k, b);
}

/** Current breaker states (monitoring). */
export function breakerSnapshot() {
  return [...breakers.entries()].map(([key, b]) => ({ key, failures: b.failures, open: b.openedAt !== null && Date.now() - b.openedAt < BREAKER_OPEN_MS, openedAt: b.openedAt }));
}

/** Test seam. */
export const resetBreakers = () => breakers.clear();
