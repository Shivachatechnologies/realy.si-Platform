import { z } from "zod";

/** Project blueprint: milestones and tasks placed relative to the project start (days). */
export const blueprintSchema = z.object({
  milestones: z.array(z.object({ title: z.string().trim().min(1).max(200), offsetDays: z.number().int().min(0).max(3650) })).max(100),
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        description: z.string().max(5000).optional(),
        priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
        offsetDays: z.number().int().min(0).max(3650),
        durationDays: z.number().int().min(0).max(3650).default(1),
        points: z.number().int().min(0).max(100).optional(),
        labels: z.array(z.string().max(40)).max(10).default([]),
        /** Title of the milestone the task belongs to. */
        milestone: z.string().max(200).optional(),
        /** Index (in this list) of a task this one depends on (finish-to-start). */
        after: z.number().int().min(0).optional(),
      }),
    )
    .max(300),
});
export type Blueprint = z.infer<typeof blueprintSchema>;

export interface BuiltInTemplate {
  key: string;
  /** i18n key suffix under work.templates.builtIn.<key> (name, description). */
  blueprint: Blueprint;
}

const t = (title: string, offsetDays: number, durationDays: number, extra: Partial<Blueprint["tasks"][number]> = {}): Blueprint["tasks"][number] => ({
  title,
  offsetDays,
  durationDays,
  priority: "MEDIUM",
  labels: [],
  ...extra,
});

/** Built-in templates. Task titles are stored in the project as written (they become editable data). */
export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  {
    key: "product_launch",
    blueprint: {
      milestones: [
        { title: "Launch plan approved", offsetDays: 7 },
        { title: "Beta complete", offsetDays: 35 },
        { title: "Public launch", offsetDays: 56 },
      ],
      tasks: [
        t("Define target audience and positioning", 0, 5, { priority: "HIGH", milestone: "Launch plan approved", points: 3, labels: ["marketing"] }),
        t("Set launch goals and success metrics", 2, 4, { milestone: "Launch plan approved", points: 2 }),
        t("Finalize feature scope for launch", 3, 5, { priority: "HIGH", milestone: "Launch plan approved", points: 3, labels: ["product"] }),
        t("Recruit beta customers", 7, 10, { milestone: "Beta complete", points: 3, labels: ["sales"] }),
        t("Run beta and collect feedback", 14, 21, { priority: "HIGH", milestone: "Beta complete", points: 8, after: 3 }),
        t("Fix launch-blocking issues", 28, 10, { priority: "URGENT", milestone: "Beta complete", points: 8, after: 4, labels: ["engineering"] }),
        t("Write launch announcement and website copy", 35, 7, { milestone: "Public launch", points: 3, labels: ["marketing"] }),
        t("Prepare sales and support enablement", 38, 7, { milestone: "Public launch", points: 3 }),
        t("Launch day: publish and announce", 56, 1, { priority: "URGENT", milestone: "Public launch", points: 2, after: 6 }),
        t("Post-launch review", 63, 2, { points: 1 }),
      ],
    },
  },
  {
    key: "website",
    blueprint: {
      milestones: [
        { title: "Sitemap and design approved", offsetDays: 14 },
        { title: "Content complete", offsetDays: 28 },
        { title: "Website live", offsetDays: 42 },
      ],
      tasks: [
        t("Kick-off: goals, audience and references", 0, 2, { priority: "HIGH", points: 1 }),
        t("Sitemap and page structure", 2, 4, { milestone: "Sitemap and design approved", points: 2, after: 0 }),
        t("Wireframes", 5, 5, { milestone: "Sitemap and design approved", points: 3, after: 1, labels: ["design"] }),
        t("Visual design", 9, 5, { priority: "HIGH", milestone: "Sitemap and design approved", points: 5, after: 2, labels: ["design"] }),
        t("Write page copy", 10, 14, { milestone: "Content complete", points: 5, labels: ["content"] }),
        t("Build pages", 15, 14, { priority: "HIGH", milestone: "Content complete", points: 8, after: 3, labels: ["engineering"] }),
        t("SEO basics: titles, descriptions, sitemap", 29, 4, { milestone: "Website live", points: 2 }),
        t("QA on mobile and desktop", 33, 5, { priority: "HIGH", milestone: "Website live", points: 3, after: 5 }),
        t("Go live and set up analytics", 42, 1, { priority: "URGENT", milestone: "Website live", points: 2, after: 7 }),
      ],
    },
  },
  {
    key: "client_onboarding",
    blueprint: {
      milestones: [
        { title: "Kick-off held", offsetDays: 3 },
        { title: "Client live", offsetDays: 21 },
      ],
      tasks: [
        t("Send welcome email and collect contacts", 0, 1, { priority: "HIGH", milestone: "Kick-off held", points: 1 }),
        t("Schedule and run kick-off call", 1, 2, { priority: "HIGH", milestone: "Kick-off held", points: 2, after: 0 }),
        t("Collect requirements and access", 3, 5, { milestone: "Client live", points: 3, after: 1 }),
        t("Configure account and integrations", 7, 7, { milestone: "Client live", points: 5, after: 2 }),
        t("Train client team", 14, 3, { milestone: "Client live", points: 3, after: 3 }),
        t("Go-live check and handover", 20, 1, { priority: "HIGH", milestone: "Client live", points: 2, after: 4 }),
        t("30-day success review", 50, 1, { points: 1 }),
      ],
    },
  },
  {
    key: "blank",
    blueprint: { milestones: [], tasks: [] },
  },
];

export const BUILT_IN_KEYS = BUILT_IN_TEMPLATES.map((b) => b.key);
