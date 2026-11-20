import { z } from "zod";

/** The founder's answers that every builder step works from. Unanswered fields are inferred by the AI when `aiFill` is on. */

export const BUSINESS_MODELS = ["b2b", "b2c", "b2b2c", "marketplace", "subscription", "ecommerce", "services", "agency", "other"] as const;
export const RUN_MODES = ["NEW_IDEA", "EXISTING", "IMPORT"] as const;
export type RunMode = (typeof RUN_MODES)[number];

const text = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);
const iso2 = z.string().regex(/^[A-Z]{2}$/);

export const briefSchema = z.object({
  idea: z.string().trim().max(4000).default(""),
  name: text(120),
  industry: text(120),
  countryCode: iso2.optional(),
  targetMarket: text(1000),
  targetMarketCodes: z.array(iso2).max(50).default([]),
  businessModel: z.enum(BUSINESS_MODELS).optional(),
  offering: text(2000),
  budgetAmount: z.number().nonnegative().max(1e12).optional(),
  budgetCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
  goals: text(2000),
  founderPreferences: text(2000),
  websiteUrl: z.string().trim().url().max(500).optional().or(z.literal("").transform(() => undefined)),
  aiFill: z.boolean().default(true),
});
export type Brief = z.infer<typeof briefSchema>;

export const parseBrief = (raw: unknown): Brief => briefSchema.parse(raw ?? {});

/** The brief as compact text for AI instructions (only what the founder answered). */
export function briefText(b: Brief, companyName: string): string {
  const lines = [
    `Company: ${b.name ?? companyName}${b.name ? "" : " (working name — the founder has not chosen a name yet)"}`,
    b.idea && `Idea / description: ${b.idea}`,
    b.industry && `Industry: ${b.industry}`,
    b.countryCode && `Home country (ISO): ${b.countryCode}`,
    (b.targetMarket || b.targetMarketCodes.length) && `Target market: ${[b.targetMarket, b.targetMarketCodes.join(", ")].filter(Boolean).join(" — ")}`,
    b.businessModel && `Business model: ${b.businessModel}`,
    b.offering && `Product / service: ${b.offering}`,
    b.budgetAmount !== undefined && `Starting budget: ${b.budgetAmount} ${b.budgetCurrency ?? ""}`.trim(),
    b.goals && `Founder goals: ${b.goals}`,
    b.founderPreferences && `Founder preferences: ${b.founderPreferences}`,
    b.websiteUrl && `Website: ${b.websiteUrl}`,
  ].filter(Boolean) as string[];
  lines.push(
    b.aiFill
      ? "Where the founder left something open, choose the most sensible option yourself and label it clearly as an assumption."
      : "Where the founder left something open, do not invent it: list it as an open question.",
  );
  return lines.join("\n").slice(0, 3000);
}
