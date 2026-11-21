import { z } from "zod";

/** Listing types (Prisma enum MarketplaceListingType). */
export const LISTING_TYPES = ["AI_EMPLOYEE", "AI_AGENT", "SKILL", "WORKFLOW", "INTEGRATION", "COMPANY_TEMPLATE", "DEPARTMENT_TEMPLATE", "INDUSTRY_BLUEPRINT"] as const;
export type ListingType = (typeof LISTING_TYPES)[number];

export const LISTING_CATEGORIES = ["industry", "operations", "sales", "marketing", "finance", "engineering", "support", "people", "productivity", "data"] as const;
export type ListingCategory = (typeof LISTING_CATEGORIES)[number];

export const PRICING_MODELS = ["FREE", "ONE_TIME", "MONTHLY"] as const;
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

/** Install-time options a listing can ask for (labels: marketplace.config.<key>). */
export const CONFIG_KEYS = ["workspaceId", "startDate", "fiscalYearStartMonth", "confirmCurrency", "includeRoles", "includeProjects", "includeObjectives"] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

const name = z.string().trim().min(1).max(120);
const text = z.string().trim().max(2000);
const days = z.number().int().min(0).max(3650);

export const manifestSchema = z.object({
  departments: z
    .array(
      z.object({
        name,
        description: text.optional(),
        teams: z
          .array(z.object({ name, description: text.optional() }))
          .max(30)
          .default([]),
      }),
    )
    .max(40)
    .default([]),
  roles: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z][a-z0-9_-]{1,48}$/),
        name,
        description: text.default(""),
        permissions: z.array(z.string().max(80)).min(1).max(200),
      }),
    )
    .max(30)
    .default([]),
  projects: z
    .array(
      z.object({
        name,
        tasks: z
          .array(
            z.object({
              title: z.string().trim().min(1).max(200),
              description: text.optional(),
              priority: z.enum(PRIORITIES).default("MEDIUM"),
              dueInDays: days.optional(),
            }),
          )
          .max(60)
          .default([]),
      }),
    )
    .max(30)
    .default([]),
  objectives: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        description: text.optional(),
        targetInDays: days.optional(),
        milestones: z
          .array(
            z.object({
              title: z.string().trim().min(1).max(200),
              dueInDays: days.optional(),
              project: name.optional(),
            }),
          )
          .max(30)
          .default([]),
      }),
    )
    .max(20)
    .default([]),
  workflows: z
    .array(
      z.object({
        key: z.string().max(80),
        name,
        trigger: z.string().max(80),
        description: text.default(""),
      }),
    )
    .max(40)
    .default([]),
  aiEmployees: z
    .array(
      z.object({
        profile: z.string().max(80),
        name,
        description: text.default(""),
      }),
    )
    .max(40)
    .default([]),
  pipelines: z
    .array(z.object({ name, stages: z.array(name).min(1).max(20) }))
    .max(10)
    .default([]),
  skills: z
    .array(
      z.object({
        key: z.string().max(80),
        name,
        description: text.default(""),
      }),
    )
    .max(40)
    .default([]),
  integrations: z
    .array(
      z.object({
        provider: z.string().max(80),
        name,
        description: text.default(""),
      }),
    )
    .max(40)
    .default([]),
  settings: z
    .object({
      fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .optional(),
    })
    .default({}),
  config: z.array(z.enum(CONFIG_KEYS)).default([]),
});
export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestInput = z.input<typeof manifestSchema>;

export const parseManifest = (raw: unknown): Manifest => manifestSchema.parse(raw ?? {});

/** Install-time configuration (validated against the listing's `config` keys by the installer). */
export const installConfigSchema = z
  .object({
    workspaceId: z.string().uuid().optional(),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
    confirmCurrency: z.boolean().optional(),
    includeRoles: z.boolean().optional(),
    includeProjects: z.boolean().optional(),
    includeObjectives: z.boolean().optional(),
  })
  .strict();
export type InstallConfig = z.infer<typeof installConfigSchema>;

export const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** Compare "1.2.3" versions: negative when a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Counts of what a manifest installs, for cards and the "what it installs" section. */
export function manifestCounts(m: Manifest) {
  return {
    departments: m.departments.length,
    teams: m.departments.reduce((n, d) => n + d.teams.length, 0),
    roles: m.roles.length,
    projects: m.projects.length,
    tasks: m.projects.reduce((n, p) => n + p.tasks.length, 0),
    objectives: m.objectives.length,
    milestones: m.objectives.reduce((n, o) => n + o.milestones.length, 0),
    workflows: m.workflows.length,
    aiEmployees: m.aiEmployees.length,
    pipelines: m.pipelines.length,
    skills: m.skills.length,
    integrations: m.integrations.length,
  };
}
export type ManifestCounts = ReturnType<typeof manifestCounts>;
