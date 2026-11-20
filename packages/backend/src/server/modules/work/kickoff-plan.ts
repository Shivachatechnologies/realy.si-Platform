import { z } from "zod";

/** The AI project manager's plan format (pure: safe for client components). */
export const planTask = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).catch("MEDIUM").default("MEDIUM"),
  offsetDays: z.coerce.number().int().min(0).max(3650).catch(0),
  durationDays: z.coerce.number().int().min(1).max(3650).catch(1).default(1),
  points: z.coerce.number().int().min(0).max(100).optional().catch(undefined),
  milestone: z.string().max(200).optional().catch(undefined),
});
export const planSchema = z.object({
  name: z.string().trim().min(1).max(120).catch("New project"),
  summary: z.string().max(2000).optional().catch(undefined),
  milestones: z.array(z.object({ title: z.string().trim().min(1).max(200), offsetDays: z.coerce.number().int().min(0).max(3650).catch(0) })).max(30).default([]),
  tasks: z.array(planTask).min(1).max(80),
});
export type ProjectPlan = z.infer<typeof planSchema>;

/** Pull the JSON plan out of the AI's answer (```json block or the outermost {...}); null when it isn't a usable plan. */
export function parsePlan(output: string | null | undefined): ProjectPlan | null {
  if (!output) return null;
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced ?? output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1);
  if (!raw.trim()) return null;
  try {
    const r = planSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

