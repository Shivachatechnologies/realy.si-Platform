import { z } from "zod";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { db } from "@/server/core/db";
import { generateImages } from "./images";
import { createProject, getProject, handoffProject, listProjects, saveScenes, stepAction } from "./pipeline";
import { brandCheckAsset, listLibrary, studioOverview } from "./library";
import { listAccounts } from "@/server/modules/marketing/social";
import { formatMicros, IMAGE_CATEGORIES, IMAGE_STYLES, PIPELINE_STEPS, PLATFORM_PRESET_KEYS, PLATFORMS, VIDEO_ASPECTS, VIDEO_TEMPLATE_KEYS } from "./presets";

/**
 * AI tools of the creative studio, registered in src/server/modules/tools/modules.ts. Reads are AUTONOMOUS; anything
 * that spends provider money or changes data is SUPERVISED; handing a video to publishing is SUPERVISED + HIGH. Approving
 * a video is never a tool — only a person approves.
 */

const steps = [...PIPELINE_STEPS] as [string, ...string[]];

export const CREATIVE_TOOLS: Record<string, ToolDefinition> = {
  read_creative_projects: def({
    name: "read_creative_projects",
    version: 1,
    description: "Lists the company's creative studio projects (videos and image sets) with status, pipeline progress, steps needing attention and estimated cost.",
    input: z.object({ q: z.string().trim().max(200).optional() }).strict(),
    modelSchema: { type: "object", properties: { q: { type: "string", description: "Optional search text" } }, additionalProperties: false },
    permissions: ["marketing.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read creative projects",
    async execute(input, { ctx, organizationId, companyId }) {
      const rows = await listProjects(ctx, organizationId, companyId, { q: input.q });
      if (!rows.length) return { content: "No creative projects yet.", count: 0 };
      return {
        content: rows.map((p) => `- ${p.name} (${p.kind}, ${p.status}) id=${p.id} · ${p.done}/${p.total} steps · next: ${p.current ?? "—"}${p.attention ? ` · ${p.attention} need attention` : ""} · cost ${formatMicros(p.costMicros)}`).join("\n"),
        count: rows.length,
        records: rows.map((p) => `creative_project:${p.id}`),
      };
    },
  }),

  read_creative_project: def({
    name: "read_creative_project",
    version: 1,
    description: "Returns one creative project: brief, every pipeline step with its status, output and error, the storyboard scenes and the produced assets.",
    input: z.object({ projectId: z.string().uuid() }).strict(),
    modelSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"], additionalProperties: false },
    permissions: ["marketing.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read a creative project",
    async execute({ projectId }, { ctx, organizationId, companyId }) {
      const p = await getProject(ctx, organizationId, companyId, projectId);
      const out = (o: unknown) => {
        if (!o || typeof o !== "object") return "";
        const r = o as Record<string, unknown>;
        if (typeof r.text === "string") return r.text.slice(0, 1500);
        return JSON.stringify({ ...r, words: undefined, cues: Array.isArray(r.cues) ? `${r.cues.length} cues` : undefined }).slice(0, 600);
      };
      const lines = [
        `${p.name} — ${p.kind} ${p.aspect}, ~${p.targetSeconds}s, status ${p.status}. Brief: ${p.brief}`,
        "Steps:",
        ...p.steps.map((s) => `- ${s.key}: ${s.status}${s.error ? ` (${s.error})` : ""}${s.output ? `\n  ${out(s.output)}` : ""}`),
        "Scenes:",
        ...p.scenes.map((s) => `${s.position}. [${s.status}, ${s.media}, ${s.seconds}s] ${s.title}: ${s.shot}${s.narration ? ` | VO: ${s.narration}` : ""}`),
        `Assets: ${p.assets.length} (${p.assets.map((a) => `${a.role ?? a.kind}`).slice(0, 30).join(", ")})`,
        `Estimated cost: ${formatMicros(p.costMicros)}`,
      ];
      return { content: lines.join("\n"), records: [`creative_project:${p.id}`] };
    },
  }),

  search_media_library: def({
    name: "search_media_library",
    version: 1,
    description: "Searches the creative media library (images, videos, audio, captions, timelines) by text, kind or category. Returns names, ids, versions, brand-check scores and costs.",
    input: z.object({ q: z.string().trim().max(200).optional(), kind: z.enum(["IMAGE", "VIDEO", "AUDIO", "CAPTIONS", "TIMELINE", "DOCUMENT"]).optional(), category: z.string().trim().max(40).optional() }).strict(),
    modelSchema: { type: "object", properties: { q: { type: "string" }, kind: { type: "string", enum: ["IMAGE", "VIDEO", "AUDIO", "CAPTIONS", "TIMELINE", "DOCUMENT"] }, category: { type: "string" } }, additionalProperties: false },
    permissions: ["marketing.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Search the media library",
    async execute(input, { ctx, organizationId, companyId }) {
      const r = await listLibrary(ctx, organizationId, companyId, { ...input, page: 1 });
      if (!r.data.length) return { content: "No matching assets.", count: 0 };
      return {
        content: r.data.map((a) => `- ${a.name} id=${a.id} (${a.kind}${a.category ? `/${a.category}` : ""}, v${a.version}${a.provider ? `, ${a.provider}` : ""}${a.brandCheck && typeof (a.brandCheck as { score?: unknown }).score === "number" ? `, brand ${(a.brandCheck as { score: number }).score}/100` : ""}, cost ${formatMicros(a.costMicros)})`).join("\n"),
        count: r.data.length,
        records: r.data.map((a) => `creative_asset:${a.id}`),
      };
    },
  }),

  read_creative_costs: def({
    name: "read_creative_costs",
    version: 1,
    description: "Creative spend over the last 30 days (estimates by provider and pipeline step), plan meters for image/video/content generations and which creative providers are connected.",
    input: z.object({}).strict(),
    modelSchema: { type: "object", properties: {}, additionalProperties: false },
    permissions: ["marketing.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read creative costs",
    async execute(_input, { ctx, organizationId, companyId }) {
      const o = await studioOverview(ctx, organizationId, companyId);
      const m = (x: { used: number; limit: number | null }) => `${x.used}/${x.limit ?? "∞"}`;
      return {
        content: [
          `Estimated creative spend (30 days): ${formatMicros(o.spendMicros)}`,
          ...o.byProvider.map((p) => `- ${p.provider}: ${formatMicros(p.costMicros)} over ${p.count} assets`),
          `Plan this month — images ${m(o.meters.image)}, videos ${m(o.meters.video)}, AI content ${m(o.meters.content)}`,
          `Connected creative providers: ${o.connected.join(", ") || "none"}`,
        ].join("\n"),
      };
    },
  }),

  generate_studio_images: def({
    name: "generate_studio_images",
    version: 1,
    description: "Propose generating on-brand images in the creative studio (product images, social graphics, posters, banners, ads, thumbnails, infographics, illustrations, brand assets) with the company's connected image provider. The brand kit (colors, fonts, tone) is applied. Needs approval; costs provider credits and counts toward the plan's image generations.",
    input: z
      .object({
        prompt: z.string().trim().min(3).max(3000),
        category: z.enum(IMAGE_CATEGORIES),
        style: z.enum(IMAGE_STYLES).optional(),
        preset: z.enum(PLATFORM_PRESET_KEYS as [string, ...string[]]).optional(),
        variants: z.number().int().min(1).max(4).optional(),
        campaignId: z.string().uuid().optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        category: { type: "string", enum: [...IMAGE_CATEGORIES] },
        style: { type: "string", enum: [...IMAGE_STYLES] },
        preset: { type: "string", enum: [...PLATFORM_PRESET_KEYS] },
        variants: { type: "integer" },
        campaignId: { type: "string" },
      },
      required: ["prompt", "category"],
      additionalProperties: false,
    },
    permissions: ["marketing.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 240_000,
    actionClass: "change_data",
    summarize: ({ prompt, variants, category }) => `Generate ${variants ?? 1} ${category} image(s): "${prompt.slice(0, 120)}"`,
    async execute(input, { ctx, organizationId, companyId }) {
      const r = await generateImages(ctx, organizationId, companyId, { ...input, preset: input.preset as never });
      return { content: `Generated ${r.created.length} image(s) with ${r.provider} (estimated ${formatMicros(r.estimatedCostMicros)}): ${r.created.join(", ")}`, records: r.created.map((id) => `creative_asset:${id}`) };
    },
  }),

  create_video_project: def({
    name: "create_video_project",
    version: 1,
    description: "Propose creating a video production project in the creative studio from an idea/brief. It sets up the pipeline (concept → script → hook → storyboard → scene assets → voiceover → music → captions → assembly → thumbnail → variants → review → export → hand-off). Needs approval; nothing is generated until steps run.",
    input: z
      .object({
        name: z.string().trim().min(1).max(160),
        brief: z.string().trim().min(10).max(4000),
        aspect: z.enum(VIDEO_ASPECTS).optional(),
        targetSeconds: z.number().int().min(5).max(180).optional(),
        platforms: z.array(z.enum(PLATFORMS)).max(8).optional(),
        audience: z.string().trim().max(500).optional(),
        objective: z.string().trim().max(500).optional(),
        templateKey: z.enum(VIDEO_TEMPLATE_KEYS as [string, ...string[]]).optional(),
        research: z.boolean().optional(),
        sceneMedia: z.enum(["image", "video"]).optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        brief: { type: "string" },
        aspect: { type: "string", enum: [...VIDEO_ASPECTS] },
        targetSeconds: { type: "integer" },
        platforms: { type: "array", items: { type: "string", enum: [...PLATFORMS] } },
        audience: { type: "string" },
        objective: { type: "string" },
        templateKey: { type: "string", enum: VIDEO_TEMPLATE_KEYS },
        research: { type: "boolean" },
        sceneMedia: { type: "string", enum: ["image", "video"] },
      },
      required: ["name", "brief"],
      additionalProperties: false,
    },
    permissions: ["marketing.manage"],
    risk: "LOW",
    autonomy: "SUPERVISED",
    timeoutMs: 20_000,
    actionClass: "change_data",
    summarize: ({ name }) => `Create video project "${name}"`,
    async execute(input, { ctx, organizationId, companyId }) {
      const r = await createProject(ctx, organizationId, companyId, {
        name: input.name,
        brief: input.brief,
        kind: "VIDEO",
        aspect: input.aspect,
        targetSeconds: input.targetSeconds,
        platforms: input.platforms,
        audience: input.audience,
        objective: input.objective,
        settings: { templateKey: input.templateKey ?? null, research: input.research, sceneMedia: input.sceneMedia },
      });
      return { content: `Created video project ${r.id}. Run its steps with run_pipeline_step.`, records: [`creative_project:${r.id}`] };
    },
  }),

  run_pipeline_step: def({
    name: "run_pipeline_step",
    version: 1,
    description: "Propose running (or re-running) one step of a video project's pipeline — e.g. concept, script, hook, storyboard, scene_assets, voiceover, captions, assembly, thumbnail, variants, export. Earlier steps must be done. Provider steps cost credits and count toward plan limits; a finished video exists only when a render provider returns it. Needs approval. Cannot approve the review.",
    input: z.object({ projectId: z.string().uuid(), step: z.enum(steps), rerun: z.boolean().optional() }).strict(),
    modelSchema: { type: "object", properties: { projectId: { type: "string" }, step: { type: "string", enum: steps }, rerun: { type: "boolean" } }, required: ["projectId", "step"], additionalProperties: false },
    permissions: ["marketing.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 300_000,
    actionClass: "change_data",
    summarize: ({ step, rerun }) => `${rerun ? "Re-run" : "Run"} pipeline step "${step}"`,
    async execute({ projectId, step, rerun }, { ctx, organizationId, companyId }) {
      if (step === "review" || step === "handoff") return { content: "Review approval and hand-off are done by a person (hand-off: use handoff_video_to_publishing)." };
      const r = await stepAction(ctx, organizationId, companyId, projectId, step, { action: rerun ? "rerun" : "run" });
      return { content: `Step ${r.key}: ${r.status}${r.error ? ` — ${r.error}` : ""}`, records: [`creative_project:${projectId}`] };
    },
  }),

  edit_pipeline_text: def({
    name: "edit_pipeline_text",
    version: 1,
    description: "Propose replacing the text of a project's concept, script or chosen hook (later steps become pending so they can be re-run). Needs approval.",
    input: z.object({ projectId: z.string().uuid(), step: z.enum(["concept", "script", "hook"]), text: z.string().trim().min(1).max(12_000) }).strict(),
    modelSchema: { type: "object", properties: { projectId: { type: "string" }, step: { type: "string", enum: ["concept", "script", "hook"] }, text: { type: "string" } }, required: ["projectId", "step", "text"], additionalProperties: false },
    permissions: ["marketing.manage"],
    risk: "LOW",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    actionClass: "change_data",
    summarize: ({ step }) => `Rewrite the ${step}`,
    async execute({ projectId, step, text }, { ctx, organizationId, companyId }) {
      await stepAction(ctx, organizationId, companyId, projectId, step, { action: "edit", text });
      return { content: `Updated the ${step}.`, records: [`creative_project:${projectId}`] };
    },
  }),

  update_storyboard: def({
    name: "update_storyboard",
    version: 1,
    description: "Propose replacing a video project's storyboard scenes (title, shot description, narration, on-screen text, seconds, media image|video). Scenes whose shot changes lose their generated media. Needs approval.",
    input: z
      .object({
        projectId: z.string().uuid(),
        scenes: z.array(z.object({ title: z.string().trim().min(1).max(120), shot: z.string().trim().min(3).max(1000), narration: z.string().trim().max(2000).optional(), onScreenText: z.string().trim().max(120).optional(), seconds: z.number().min(1).max(30), media: z.enum(["image", "video"]).optional() }).strict()).min(1).max(30),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        scenes: {
          type: "array",
          items: { type: "object", properties: { title: { type: "string" }, shot: { type: "string" }, narration: { type: "string" }, onScreenText: { type: "string" }, seconds: { type: "number" }, media: { type: "string", enum: ["image", "video"] } }, required: ["title", "shot", "seconds"], additionalProperties: false },
        },
      },
      required: ["projectId", "scenes"],
      additionalProperties: false,
    },
    permissions: ["marketing.manage"],
    risk: "LOW",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    actionClass: "change_data",
    summarize: ({ scenes }) => `Replace the storyboard (${scenes.length} scenes)`,
    async execute({ projectId, scenes }, { ctx, organizationId, companyId }) {
      // Keep generated media for scenes whose shot is unchanged.
      const existing = await db().creativeScene.findMany({ where: { projectId, organizationId, companyId }, select: { id: true, shot: true, media: true } });
      const r = await saveScenes(ctx, organizationId, companyId, projectId, { scenes: scenes.map((s) => ({ ...s, id: existing.find((e) => e.shot === s.shot && e.media === (s.media ?? "image"))?.id })) });
      return { content: `Storyboard saved (${r.scenes} scenes).`, records: [`creative_project:${projectId}`] };
    },
  }),

  check_brand_consistency: def({
    name: "check_brand_consistency",
    version: 1,
    description: "Propose running a brand-consistency check on a library image: measures brand-palette coverage from the pixels and (when OpenAI is connected and the brand kit has a logo) asks a vision model about logo usage and text errors. Stores the result on the asset. Needs approval.",
    input: z.object({ assetId: z.string().uuid() }).strict(),
    modelSchema: { type: "object", properties: { assetId: { type: "string" } }, required: ["assetId"], additionalProperties: false },
    permissions: ["marketing.manage"],
    risk: "LOW",
    autonomy: "SUPERVISED",
    timeoutMs: 90_000,
    actionClass: "change_data",
    summarize: () => "Check an image against the brand kit",
    async execute({ assetId }, { ctx, organizationId, companyId }) {
      const r = await brandCheckAsset(ctx, organizationId, companyId, assetId);
      return {
        content: `Brand score: ${r.score ?? "n/a"}/100. Palette coverage: ${r.palette ? `${Math.round(r.palette.brandCoverage * 100)}%` : (r.paletteNote ?? "n/a")}${r.palette?.offPalette.length ? `, off-palette: ${r.palette.offPalette.join(", ")}` : ""}. Logo: ${r.logo.checked ? `visible=${r.logo.logoVisible}, matches=${r.logo.matchesReference}; text issues: ${r.logo.textIssues?.join("; ") || "none"}` : `not checked (${r.logo.reason})`}.`,
        records: [`creative_asset:${assetId}`],
      };
    },
  }),

  read_publishing_accounts: def({
    name: "read_publishing_accounts",
    version: 1,
    description: "Lists the company's social accounts in marketing (ids, platform, name, whether the platform is connected) — the targets for handoff_video_to_publishing.",
    input: z.object({}).strict(),
    modelSchema: { type: "object", properties: {}, additionalProperties: false },
    permissions: ["marketing.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read social accounts",
    async execute(_input, { ctx, organizationId, companyId }) {
      const { accounts } = await listAccounts(ctx, organizationId, companyId);
      if (!accounts.length) return { content: "No social accounts are set up in marketing.", count: 0 };
      return { content: accounts.map((a) => `- ${a.name} (${a.provider}) id=${a.id}${a.connected ? "" : " — platform not connected"}`).join("\n"), count: accounts.length };
    },
  }),

  handoff_video_to_publishing: def({
    name: "handoff_video_to_publishing",
    version: 1,
    description: "Propose handing an APPROVED video project to marketing publishing: creates a draft social post with the finished render (or the thumbnail) for the given social accounts. Scheduling/publishing then follows marketing's approval rules. Needs approval.",
    input: z.object({ projectId: z.string().uuid(), title: z.string().trim().min(1).max(200), text: z.string().max(5000), accountIds: z.array(z.string().uuid()).min(1).max(20), media: z.enum(["render", "thumbnail"]).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, title: { type: "string" }, text: { type: "string" }, accountIds: { type: "array", items: { type: "string" } }, media: { type: "string", enum: ["render", "thumbnail"] } },
      required: ["projectId", "title", "text", "accountIds"],
      additionalProperties: false,
    },
    permissions: ["marketing.manage"],
    risk: "HIGH",
    autonomy: "SUPERVISED",
    timeoutMs: 30_000,
    actionClass: "publish",
    channel: "social",
    summarize: ({ title, accountIds }) => `Hand "${title}" to publishing (${accountIds.length} account(s))`,
    async execute(input, { ctx, organizationId, companyId }) {
      const r = await handoffProject(ctx, organizationId, companyId, input.projectId, input);
      return { content: `Draft social post ${r.postId} created in marketing (not scheduled).`, records: [`creative_project:${input.projectId}`, `marketing_social_post:${r.postId}`] };
    },
  }),
};
