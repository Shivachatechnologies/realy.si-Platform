import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { CreativeStepStatus } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { AppError, conflict, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { getControls } from "@/server/core/platform-controls";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { assertLimit, creditsForTokens, recordUsage } from "@/server/modules/entitlements/service";
import { isCompanyAiPaused } from "@/server/modules/workforce/autonomy-policy";
import { generateText } from "@/server/modules/integrations/services/ai-text";
import { webSearch } from "@/server/modules/integrations/services/research";
import { generateImage } from "@/server/modules/integrations/services/images";
import { getSignedUrl, newObjectKey, putObject } from "@/server/modules/integrations/services/storage";
import { estimateWordTimings, generateVoiceover, VOICEOVER_PROVIDERS, type WordTiming } from "@/server/modules/integrations/services/voiceover";
import { CLIP_PROVIDERS, pollRender, pollSceneClip, RENDER_PROVIDERS, startRender, startSceneClip, type ClipAspect, type RenderProvider, type RenderTimeline } from "@/server/modules/integrations/services/video-pipeline";
import { searchLicensedMusic } from "@/server/modules/integrations/services/music";
import { loadBrandKit } from "@/server/modules/marketing/brand";
import { createPost } from "@/server/modules/marketing/social";
import { download } from "@/server/modules/marketing/providers/http";
import { actorId, addMicros, assertTextAiAllowed, authorize, brandLines, buildImagePrompt, emitCreativeEvent, isUuid, json, marketingAssetsById, marketingAssetUrls, serviceFailure, toBig, uuid } from "./common";
import { saveVisual, sizeFor } from "./images";
import { buildTimeline, cuesFromWords, toEdl, toSrt, toVtt, type Cue, type EditTimeline } from "./timeline";
import {
  ASPECT_SIZE,
  EDITABLE,
  MANUAL_ONLY,
  OPENAI_VOICES,
  PIPELINE_STEPS,
  PLATFORMS,
  SKIPPABLE,
  STEP_DEPENDS,
  VIDEO_ASPECTS,
  VIDEO_TEMPLATES,
  type PipelineStep,
  type VideoAspect,
} from "./presets";

/**
 * Video pipeline: a persisted, resumable job graph per project (creative_steps rows) — idea → research → concept →
 * script → hook → storyboard → scene assets → voiceover → music → captions → assembly → thumbnail → platform variants →
 * review → export → hand-off to marketing publishing. Each step is claimed atomically, its result persisted, and
 * provider jobs (clips, renders) are polled by the worker. A finished video is claimed only when a render provider
 * returned a completed asset URL; otherwise assembly delivers an editable timeline (JSON + EDL) and says rendering
 * needs a provider.
 */

const DONE: CreativeStepStatus[] = ["SUCCEEDED", "SKIPPED"];
const RUNNABLE: CreativeStepStatus[] = ["PENDING", "FAILED", "BLOCKED", "NEEDS_INPUT"];
const settingsSchema = z
  .object({
    research: z.boolean().optional(),
    sceneMedia: z.enum(["image", "video"]).optional(),
    videoProvider: z.enum(CLIP_PROVIDERS).nullable().optional(),
    voiceProvider: z.enum(VOICEOVER_PROVIDERS).nullable().optional(),
    voice: z.string().trim().max(60).nullable().optional(),
    voiceStyle: z.string().trim().max(300).nullable().optional(),
    renderProvider: z.enum(RENDER_PROVIDERS).nullable().optional(),
    templateKey: z.string().max(40).nullable().optional(),
  })
  .strict();
export type PipelineSettings = z.infer<typeof settingsSchema>;
const readSettings = (v: Prisma.JsonValue): PipelineSettings => {
  const r = settingsSchema.safeParse(v ?? {});
  return r.success ? r.data : {};
};

export const createProjectInput = z.object({
  name: z.string().trim().min(1).max(160),
  brief: z.string().trim().min(10).max(4000),
  kind: z.enum(["VIDEO", "IMAGE_SET"]).default("VIDEO"),
  objective: z.string().trim().max(500).nullable().optional(),
  audience: z.string().trim().max(500).nullable().optional(),
  platforms: z.array(z.enum(PLATFORMS)).max(PLATFORMS.length).default([]),
  aspect: z.enum(VIDEO_ASPECTS).default("9:16"),
  targetSeconds: z.number().int().min(5).max(180).default(30),
  language: z.string().trim().min(2).max(12).default("en"),
  campaignId: uuid.nullable().optional(),
  folderId: uuid.nullable().optional(),
  autoAdvance: z.boolean().default(false),
  settings: settingsSchema.default({}),
});
export const updateProjectInput = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  brief: z.string().trim().min(10).max(4000).optional(),
  objective: z.string().trim().max(500).nullable().optional(),
  audience: z.string().trim().max(500).nullable().optional(),
  platforms: z.array(z.enum(PLATFORMS)).max(PLATFORMS.length).optional(),
  aspect: z.enum(VIDEO_ASPECTS).optional(),
  targetSeconds: z.number().int().min(5).max(180).optional(),
  autoAdvance: z.boolean().optional(),
  campaignId: uuid.nullable().optional(),
  folderId: uuid.nullable().optional(),
  settings: settingsSchema.optional(),
});
export const stepActionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run") }),
  z.object({ action: z.literal("rerun") }),
  z.object({ action: z.literal("skip") }),
  z.object({ action: z.literal("edit"), text: z.string().trim().min(1).max(12_000) }),
]);
const sceneInput = z.object({
  id: uuid.optional(),
  title: z.string().trim().min(1).max(120),
  shot: z.string().trim().min(3).max(1000),
  narration: z.string().trim().max(2000).default(""),
  onScreenText: z.string().trim().max(120).nullable().optional(),
  seconds: z.number().min(1).max(30).default(4),
  media: z.enum(["image", "video"]).default("image"),
});
export const saveScenesInput = z.object({ scenes: z.array(sceneInput).min(1).max(30) });
export const reviewInput = z.object({ decision: z.enum(["approve", "changes"]), note: z.string().trim().max(2000).optional() });
export const musicInput = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("upload"),
    name: z.string().trim().min(1).max(160),
    mimeType: z.enum(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/aac", "audio/mp4", "audio/ogg"]),
    dataBase64: z.string().min(16).max(28_000_000),
    /** The person confirms they hold a license to use this track commercially. */
    attest: z.literal(true),
    licenseNote: z.string().trim().min(3).max(500),
    attribution: z.string().trim().max(300).optional(),
  }),
  z.object({ source: z.literal("jamendo"), trackId: z.string().regex(/^\d{1,12}$/) }),
]);
export const musicSearchInput = z.object({ q: z.string().trim().max(100).default("") });
export const handoffInput = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().max(5000).default(""),
  accountIds: z.array(uuid).min(1).max(20),
  /** Use the render (default) or the thumbnail as the post media. */
  media: z.enum(["render", "thumbnail"]).default("render"),
});

// ───────────── Projects ─────────────

async function owned<T extends "marketingCampaign" | "creativeFolder">(model: T, organizationId: string, companyId: string, id: string | null | undefined) {
  if (!id) return null;
  if (!isUuid(id)) throw notFound("Record");
  const where = { id, organizationId, companyId };
  const row = model === "marketingCampaign" ? await db().marketingCampaign.findFirst({ where, select: { id: true } }) : await db().creativeFolder.findFirst({ where, select: { id: true } });
  if (!row) throw notFound(model === "marketingCampaign" ? "Campaign" : "Folder");
  return id;
}

export async function createProject(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof createProjectInput>) {
  const input = createProjectInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const [campaignId, folderId] = await Promise.all([owned("marketingCampaign", organizationId, companyId, input.campaignId), owned("creativeFolder", organizationId, companyId, input.folderId)]);
  const template = input.settings.templateKey ? VIDEO_TEMPLATES.find((t) => t.key === input.settings.templateKey) : null;
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const p = await tx.creativeProject.create({
      data: {
        organizationId,
        companyId,
        kind: input.kind,
        status: input.kind === "VIDEO" ? "IN_PROGRESS" : "DRAFT",
        name: input.name,
        brief: input.brief,
        objective: input.objective ?? null,
        audience: input.audience ?? null,
        platforms: input.platforms,
        aspect: template?.aspect ?? input.aspect,
        targetSeconds: template?.seconds ?? input.targetSeconds,
        language: input.language,
        campaignId,
        folderId,
        autoAdvance: input.autoAdvance,
        settings: json(input.settings),
        createdById: actorId(ctx, organizationId),
      },
      select: { id: true },
    });
    if (input.kind === "VIDEO") {
      await tx.creativeStep.createMany({
        data: PIPELINE_STEPS.map((key, position) => ({
          organizationId,
          companyId,
          projectId: p.id,
          key,
          position,
          status: key === "idea" ? "SUCCEEDED" : key === "research" && !input.settings.research ? "SKIPPED" : "PENDING",
          output: key === "idea" ? json({ text: input.brief, objective: input.objective ?? null, audience: input.audience ?? null }) : undefined,
          finishedAt: key === "idea" ? new Date() : null,
        })) satisfies Prisma.CreativeStepCreateManyInput[],
      });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "creative.project.created", resourceType: "creative_project", resourceId: p.id, newValue: { name: input.name, kind: input.kind } });
    await emitCreativeEvent(tx, ctx, "creative.project_created", { organizationId, companyId, entityType: "creative_project", entityId: p.id, data: { name: input.name, kind: input.kind, campaignId } });
    return { id: p.id };
  });
}

export async function updateProject(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, raw: z.input<typeof updateProjectInput>) {
  const input = updateProjectInput.parse(raw);
  if (!isUuid(projectId)) throw notFound("Project");
  const [campaignId, folderId] = await Promise.all([
    input.campaignId === undefined ? undefined : owned("marketingCampaign", organizationId, companyId, input.campaignId),
    input.folderId === undefined ? undefined : owned("creativeFolder", organizationId, companyId, input.folderId),
  ]);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const p = await tx.creativeProject.findFirst({ where: { id: projectId, organizationId, companyId, archivedAt: null }, select: { settings: true } });
    if (!p) throw notFound("Project");
    await tx.creativeProject.update({
      where: { id: projectId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.brief !== undefined ? { brief: input.brief } : {}),
        ...(input.objective !== undefined ? { objective: input.objective } : {}),
        ...(input.audience !== undefined ? { audience: input.audience } : {}),
        ...(input.platforms !== undefined ? { platforms: input.platforms } : {}),
        ...(input.aspect !== undefined ? { aspect: input.aspect } : {}),
        ...(input.targetSeconds !== undefined ? { targetSeconds: input.targetSeconds } : {}),
        ...(input.autoAdvance !== undefined ? { autoAdvance: input.autoAdvance } : {}),
        ...(campaignId !== undefined ? { campaignId } : {}),
        ...(folderId !== undefined ? { folderId } : {}),
        ...(input.settings !== undefined ? { settings: json({ ...readSettings(p.settings), ...input.settings }) } : {}),
      },
    });
    if (input.brief !== undefined) await tx.creativeStep.updateMany({ where: { projectId, companyId, key: "idea" }, data: { output: json({ text: input.brief }), edited: true } });
    if (input.settings?.research !== undefined) {
      await tx.creativeStep.updateMany({ where: { projectId, companyId, key: "research", status: { in: input.settings.research ? ["SKIPPED"] : ["PENDING", "FAILED", "BLOCKED"] } }, data: { status: input.settings.research ? "PENDING" : "SKIPPED" } });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "creative.project.updated", resourceType: "creative_project", resourceId: projectId, newValue: { ...input, settings: input.settings ?? undefined } });
    return { ok: true };
  });
}

export async function archiveProject(ctx: RequestContext, organizationId: string, companyId: string, projectId: string) {
  if (!isUuid(projectId)) throw notFound("Project");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.creativeProject.updateMany({ where: { id: projectId, organizationId, companyId, archivedAt: null }, data: { archivedAt: new Date(), status: "ARCHIVED", autoAdvance: false } });
    if (!count) throw notFound("Project");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "creative.project.archived", resourceType: "creative_project", resourceId: projectId });
    return { ok: true };
  });
}

export async function listProjects(ctx: RequestContext, organizationId: string, companyId: string, opts: { q?: string; status?: string } = {}) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const rows = await db().creativeProject.findMany({
    where: {
      organizationId,
      companyId,
      archivedAt: null,
      ...(opts.q ? { OR: [{ name: { contains: opts.q, mode: "insensitive" } }, { brief: { contains: opts.q, mode: "insensitive" } }] } : {}),
      ...(opts.status && ["DRAFT", "IN_PROGRESS", "IN_REVIEW", "APPROVED", "EXPORTED"].includes(opts.status) ? { status: opts.status as never } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, kind: true, status: true, name: true, brief: true, aspect: true, targetSeconds: true, platforms: true, autoAdvance: true, updatedAt: true, createdAt: true, steps: { select: { key: true, status: true, costMicros: true, position: true }, orderBy: { position: "asc" } } },
  });
  const assetCost = await db().creativeAsset.groupBy({ by: ["projectId"], where: { organizationId, companyId, projectId: { in: rows.map((r) => r.id) }, operation: { in: ["regenerate", "edit", "upscale", "generate", "variant"] }, sceneId: null, role: null }, _sum: { costMicros: true } });
  const extra = new Map(assetCost.map((a) => [a.projectId, a._sum.costMicros ?? 0n]));
  return rows.map(({ steps, ...p }) => ({
    ...p,
    rail: steps.map((s) => ({ key: s.key, status: s.status as string })),
    done: steps.filter((s) => DONE.includes(s.status)).length,
    total: steps.length,
    current: steps.find((s) => !DONE.includes(s.status))?.key ?? null,
    attention: steps.filter((s) => ["FAILED", "BLOCKED", "NEEDS_INPUT"].includes(s.status)).length,
    running: steps.some((s) => s.status === "RUNNING" || s.status === "WAITING_PROVIDER"),
    costMicros: steps.reduce((sum, s) => sum + (s.costMicros ?? 0n), 0n) + (extra.get(p.id) ?? 0n),
  }));
}

export async function getProject(ctx: RequestContext, organizationId: string, companyId: string, projectId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  if (!isUuid(projectId)) throw notFound("Project");
  const p = await db().creativeProject.findFirst({
    where: { id: projectId, organizationId, companyId, archivedAt: null },
    include: { steps: { orderBy: { position: "asc" } }, scenes: { orderBy: { position: "asc" } } },
  });
  if (!p) throw notFound("Project");
  const assets = await db().creativeAsset.findMany({ where: { organizationId, companyId, projectId, archivedAt: null }, orderBy: { createdAt: "desc" }, take: 200 });
  const library = await marketingAssetsById(organizationId, companyId, [...p.scenes.map((s) => s.assetId), ...assets.map((a) => a.marketingAssetId)]);
  const urlOf = async (marketingAssetId: string | null) => {
    const m = marketingAssetId ? library.get(marketingAssetId) : null;
    return m ? { ...(await marketingAssetUrls(m)), status: m.status } : null;
  };
  const scenes = await Promise.all(p.scenes.map(async (s) => ({ ...s, media: s.media as "image" | "video", file: await urlOf(s.assetId) })));
  const signed = async (ref: string) => {
    const r = await getSignedUrl(organizationId, companyId, ref, 3600);
    return r.ok ? r.data.url : null;
  };
  const files = await Promise.all(
    assets.map(async (a) => ({
      ...a,
      file: a.marketingAssetId ? await urlOf(a.marketingAssetId) : a.storageRef ? { publicUrl: null, previewUrl: await signed(a.storageRef), status: "READY" } : a.url ? { publicUrl: a.url, previewUrl: a.url, status: "READY" } : null,
    })),
  );
  const stepCost = p.steps.reduce((s, x) => s + (x.costMicros ?? 0n), 0n);
  const looseCost = assets.filter((a) => !a.sceneId && !a.role).reduce((s, a) => s + (a.costMicros ?? 0n), 0n);
  return { ...p, settings: readSettings(p.settings), scenes, assets: files, costMicros: stepCost + looseCost };
}

// ───────────── Step engine ─────────────

type ProjectRow = Prisma.CreativeProjectGetPayload<{ include: { steps: true; scenes: true } }>;
type StepRow = ProjectRow["steps"][number];

interface StepResult {
  status: CreativeStepStatus;
  output?: Record<string, unknown> | null;
  error?: string | null;
  provider?: string | null;
  providerJobId?: string | null;
  costMicros?: number | null;
  nextPollAt?: Date | null;
}

class StepBlocked extends Error {
  constructor(
    message: string,
    readonly status: "BLOCKED" | "NEEDS_INPUT" = "BLOCKED",
  ) {
    super(message);
  }
}

const outputOf = (steps: StepRow[], key: PipelineStep) => (steps.find((s) => s.key === key)?.output ?? null) as Record<string, unknown> | null;
const textOf = (steps: StepRow[], key: PipelineStep) => {
  const o = outputOf(steps, key);
  return typeof o?.text === "string" ? o.text : "";
};
const pollAt = (seconds: number) => new Date(Date.now() + seconds * 1000);

async function loadProject(organizationId: string, companyId: string, projectId: string): Promise<ProjectRow> {
  const p = await db().creativeProject.findFirst({ where: { id: projectId, organizationId, companyId, archivedAt: null }, include: { steps: { orderBy: { position: "asc" } }, scenes: { orderBy: { position: "asc" } } } });
  if (!p) throw notFound("Project");
  if (p.kind !== "VIDEO") throw invalid("This project has no pipeline", { reason: "creative_not_video" });
  return p;
}

/** Dependents of a step (transitively). */
function downstream(key: PipelineStep): PipelineStep[] {
  const out = new Set<PipelineStep>();
  const visit = (k: PipelineStep) => {
    for (const s of PIPELINE_STEPS) if (STEP_DEPENDS[s].includes(k) && !out.has(s)) {
      out.add(s);
      visit(s);
    }
  };
  visit(key);
  return [...out];
}

/** Completed dependents become PENDING again (their outputs are kept until re-run); approval is withdrawn. */
async function markStale(projectId: string, companyId: string, key: PipelineStep) {
  const keys = downstream(key);
  if (!keys.length) return;
  await db().creativeStep.updateMany({ where: { projectId, companyId, key: { in: keys }, status: { in: ["SUCCEEDED", "NEEDS_INPUT"] } }, data: { status: "PENDING" } });
  if (keys.includes("review")) await db().creativeProject.updateMany({ where: { id: projectId, companyId, status: { in: ["IN_REVIEW", "APPROVED", "EXPORTED"] } }, data: { status: "IN_PROGRESS", approvedAt: null, approvedById: null } });
}

const depsDone = (p: ProjectRow, key: PipelineStep) => STEP_DEPENDS[key].every((d) => DONE.includes(p.steps.find((s) => s.key === d)?.status ?? "PENDING"));

/** Text generation with plan metering (content generations + AI credits). */
async function aiText(p: ProjectRow, ctx: RequestContext | null, system: string, prompt: string, maxOutputTokens = 1500) {
  await assertTextAiAllowed(p.organizationId);
  await assertLimit(ctx, p.organizationId, "content.generations.month", 1);
  const r = await generateText(p.organizationId, p.companyId, { system, prompt, maxOutputTokens, temperature: 0.8 });
  if (!r.ok) {
    if (r.code === "not_connected") throw new StepBlocked("Connect an AI text provider (OpenAI or Gemini) in Integrations to write concepts, scripts and storyboards.");
    throw new Error(r.error);
  }
  await recordUsage(p.organizationId, "content.generations", 1, { companyId: p.companyId });
  await recordUsage(p.organizationId, "ai.credits", creditsForTokens(r.data.inputTokens + r.data.outputTokens), { companyId: p.companyId });
  return { text: r.data.text.trim(), costMicros: r.data.estimatedCostMicros, provider: r.providerId };
}

function parseJson<T>(text: string, schema: z.ZodType<T>): T {
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (start < 0 || end < start) throw new Error("The AI did not return the expected structure; run the step again.");
  const parsed = schema.safeParse(JSON.parse(text.slice(start, end + 1)));
  if (!parsed.success) throw new Error("The AI returned an incomplete structure; run the step again.");
  return parsed.data;
}

async function directorContext(p: ProjectRow) {
  const kit = await loadBrandKit(db(), p.companyId);
  return [
    `Project: ${p.name}. Format: ${p.aspect} video, about ${p.targetSeconds} seconds, for ${p.platforms.join(", ") || "social media"}. Language: ${p.language}.`,
    p.objective ? `Objective: ${p.objective}.` : "",
    p.audience ? `Audience: ${p.audience}.` : "",
    kit ? `Brand: ${kit.brandName}${kit.tagline ? ` — ${kit.tagline}` : ""}. Voice: ${kit.voiceTone?.slice(0, 600) ?? "not set"}. Pillars: ${kit.messagingPillars.join(", ") || "not set"}. Preferred words: ${kit.doWords.slice(0, 20).join(", ") || "—"}. Never use: ${kit.dontWords.slice(0, 20).join(", ") || "—"}.` : "No brand kit is set; keep the tone neutral and professional.",
  ]
    .filter(Boolean)
    .join("\n");
}
const SYSTEM = "You are an award-winning creative director and video producer. Ground every claim in the brief and the research given; never invent customers, statistics, prices or testimonials. Write for the stated platform and length.";

const scenesSchema = z.object({
  scenes: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        shot: z.string().min(3).max(1000),
        narration: z.string().max(2000).default(""),
        onScreenText: z.string().max(120).nullable().optional(),
        seconds: z.number().min(1).max(30),
        media: z.enum(["image", "video"]).optional(),
      }),
    )
    .min(1)
    .max(30),
});

/** The executor of each step. `ctx` is the acting person (null in the worker). */
async function execute(p: ProjectRow, step: StepRow, actx: RequestContext | null): Promise<StepResult> {
  const key = step.key as PipelineStep;
  const settings = readSettings(p.settings);
  const ctx = actx ?? systemContext();
  switch (key) {
    case "idea":
      return { status: "SUCCEEDED", output: { text: p.brief } };

    case "research": {
      const r = await webSearch(p.organizationId, p.companyId, `${p.brief.slice(0, 300)} ${p.audience ?? ""}`.trim(), { maxResults: 6 });
      if (!r.ok) {
        if (r.code === "not_connected") throw new StepBlocked("Connect a research provider (Tavily, Exa or SerpApi) in Integrations, or skip research.");
        throw new Error(r.error);
      }
      return { status: "SUCCEEDED", provider: r.providerId, output: { query: r.data.query, results: r.data.results.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet })) } };
    }

    case "concept": {
      const research = outputOf(p.steps, "research");
      const sources = Array.isArray(research?.results) ? (research.results as { title: string; url: string; snippet: string }[]).map((x, i) => `[${i + 1}] ${x.title} — ${x.snippet} (${x.url})`).join("\n") : "";
      const r = await aiText(p, actx, SYSTEM, `${await directorContext(p)}\n\nBrief:\n${p.brief}\n${sources ? `\nResearch (cite as [n] when used):\n${sources}\n` : ""}\nWrite the creative concept in 120–200 words: the big idea, the emotional angle, the visual style (look, palette, pacing) and why it works for this audience. Plain text, no headings.`, 700);
      return { status: "SUCCEEDED", provider: r.provider, costMicros: r.costMicros, output: { text: r.text } };
    }

    case "script": {
      const words = Math.round(p.targetSeconds * 2.4);
      const r = await aiText(p, actx, SYSTEM, `${await directorContext(p)}\n\nConcept:\n${textOf(p.steps, "concept")}\n\nWrite the voiceover script: about ${words} words (${p.targetSeconds} seconds spoken), short sentences, one clear call to action at the end. Return only the words to be spoken — no stage directions, no labels.`, 1200);
      return { status: "SUCCEEDED", provider: r.provider, costMicros: r.costMicros, output: { text: r.text.replace(/^["“]|["”]$/g, "") } };
    }

    case "hook": {
      const r = await aiText(p, actx, SYSTEM, `${await directorContext(p)}\n\nScript:\n${textOf(p.steps, "script")}\n\nWrite 3 alternative opening hooks (max 12 words each) that stop the scroll in the first 2 seconds. Return JSON: {"hooks":["…","…","…"]}`, 400);
      const parsed = parseJson(r.text, z.object({ hooks: z.array(z.string().min(2).max(200)).min(1).max(5) }));
      return { status: "SUCCEEDED", provider: r.provider, costMicros: r.costMicros, output: { options: parsed.hooks, text: parsed.hooks[0] } };
    }

    case "storyboard": {
      const template = settings.templateKey ? VIDEO_TEMPLATES.find((t) => t.key === settings.templateKey) : null;
      const outline = template ? `\nFollow this scene structure:\n${template.outline.map((o, i) => `${i + 1}. ${o.title} — ${o.shot} (${o.seconds}s)`).join("\n")}` : "";
      const media = settings.sceneMedia ?? "image";
      const r = await aiText(
        p,
        actx,
        SYSTEM,
        `${await directorContext(p)}\n\nConcept:\n${textOf(p.steps, "concept")}\n\nOpening hook (scene 1 must deliver it): ${textOf(p.steps, "hook") || "—"}\n\nVoiceover script:\n${textOf(p.steps, "script")}${outline}\n\nBreak the video into 4–10 scenes whose seconds add up to about ${p.targetSeconds}. For each scene give: title, shot (a precise visual description for an image/video generator: subject, setting, framing, camera movement, lighting — no text in frame), narration (the part of the script spoken over it, in order, together covering the whole script), onScreenText (≤ 6 words or null), seconds, media ("${media}"). Return JSON: {"scenes":[…]}`,
        2500,
      );
      const parsed = parseJson(r.text, scenesSchema);
      await transaction(async (tx) => {
        await tx.creativeScene.deleteMany({ where: { projectId: p.id, companyId: p.companyId } });
        await tx.creativeScene.createMany({
          data: parsed.scenes.map((s, i) => ({ organizationId: p.organizationId, companyId: p.companyId, projectId: p.id, position: i + 1, title: s.title, shot: s.shot, narration: s.narration, onScreenText: s.onScreenText ?? null, seconds: s.seconds, media: s.media ?? media })),
        });
      });
      return { status: "SUCCEEDED", provider: r.provider, costMicros: r.costMicros, output: { scenes: parsed.scenes.length, seconds: parsed.scenes.reduce((a, s) => a + s.seconds, 0) } };
    }

    case "scene_assets":
      return generateSceneAssets(p, ctx, actx);

    case "voiceover": {
      const scenesText = p.scenes.map((s) => s.narration).filter(Boolean).join(" ");
      const script = (textOf(p.steps, "script") || scenesText).trim();
      const hookStep = p.steps.find((s) => s.key === "hook");
      const hook = hookStep?.status === "SUCCEEDED" ? textOf(p.steps, "hook").trim() : "";
      // The chosen hook opens the video: prepend it when the script does not already start with it.
      const text = hook && !script.toLowerCase().startsWith(hook.toLowerCase().slice(0, 20)) ? `${hook} ${script}` : script;
      if (!text) throw new StepBlocked("Write the script first.", "NEEDS_INPUT");
      const providers = settings.voiceProvider ? [settings.voiceProvider, ...VOICEOVER_PROVIDERS.filter((v) => v !== settings.voiceProvider)] : VOICEOVER_PROVIDERS;
      const r = await generateVoiceover(p.organizationId, p.companyId, { text, voice: settings.voice ?? null, instructions: settings.voiceStyle ?? null, providers });
      if (!r.ok) {
        if (r.code === "not_connected") throw new StepBlocked("Connect ElevenLabs or OpenAI in Integrations to record the voiceover, or skip it.");
        throw new Error(r.error);
      }
      const asset = await db().creativeAsset.create({
        data: { organizationId: p.organizationId, companyId: p.companyId, kind: "AUDIO", name: `${p.name} — voiceover`, storageRef: r.data.audio.ref, mimeType: "audio/mpeg", sizeBytes: r.data.audio.size, role: "voiceover", provider: r.providerId, model: r.data.model, projectId: p.id, campaignId: p.campaignId, operation: "generate", costMicros: toBig(r.data.estimatedCostMicros), createdById: actorId(ctx, p.organizationId) },
        select: { id: true },
      });
      return { status: "SUCCEEDED", provider: r.providerId, costMicros: r.data.estimatedCostMicros, output: { assetId: asset.id, voice: r.data.voice, duration: r.data.durationSeconds, timing: r.data.timing, words: r.data.words } };
    }

    case "music": {
      const m = await db().creativeAsset.findFirst({ where: { projectId: p.id, companyId: p.companyId, role: "music", archivedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, license: true } });
      if (!m) throw new StepBlocked("Choose a licensed track (connected licensed source) or upload music you hold a license for — or skip music.", "NEEDS_INPUT");
      return { status: "SUCCEEDED", output: { assetId: m.id, name: m.name, license: m.license } };
    }

    case "captions": {
      const vo = outputOf(p.steps, "voiceover");
      const voDone = p.steps.find((s) => s.key === "voiceover")?.status === "SUCCEEDED";
      let words: WordTiming[];
      let timing: string;
      if (voDone && Array.isArray(vo?.words)) {
        words = vo.words as WordTiming[];
        timing = String(vo.timing ?? "estimated");
      } else {
        const text = textOf(p.steps, "script") || p.scenes.map((s) => s.narration).join(" ");
        if (!text.trim()) throw new StepBlocked("Captions need a script.", "NEEDS_INPUT");
        words = estimateWordTimings(text, p.scenes.reduce((a, s) => a + s.seconds, 0) || p.targetSeconds);
        timing = "estimated";
      }
      const cues = cuesFromWords(words);
      const [srt, vtt] = await Promise.all([
        putObject(p.organizationId, p.companyId, { key: newObjectKey("creative-captions", "srt"), body: new TextEncoder().encode(toSrt(cues)), contentType: "application/x-subrip" }),
        putObject(p.organizationId, p.companyId, { key: newObjectKey("creative-captions", "vtt"), body: new TextEncoder().encode(toVtt(cues)), contentType: "text/vtt" }),
      ]);
      if (!srt.ok || !vtt.ok) throw new Error(`captions could not be stored: ${!srt.ok ? srt.error : !vtt.ok ? vtt.error : ""}`);
      const by = actorId(ctx, p.organizationId);
      const base = { organizationId: p.organizationId, companyId: p.companyId, kind: "CAPTIONS" as const, projectId: p.id, campaignId: p.campaignId, operation: "generate", createdById: by };
      const [a1, a2] = await Promise.all([
        db().creativeAsset.create({ data: { ...base, name: `${p.name}.srt`, storageRef: srt.data.ref, mimeType: "application/x-subrip", sizeBytes: srt.data.size, role: "captions_srt" }, select: { id: true } }),
        db().creativeAsset.create({ data: { ...base, name: `${p.name}.vtt`, storageRef: vtt.data.ref, mimeType: "text/vtt", sizeBytes: vtt.data.size, role: "captions_vtt" }, select: { id: true } }),
      ]);
      return { status: "SUCCEEDED", output: { cues, timing, srtAssetId: a1.id, vttAssetId: a2.id } };
    }

    case "assembly":
      return assemble(p, ctx, settings, p.aspect as VideoAspect, "assembly");

    case "thumbnail": {
      await assertLimit(actx, p.organizationId, "image.generations.month", 1);
      const hook = textOf(p.steps, "hook");
      const preset = p.aspect === "9:16" ? { width: 1080, height: 1920, key: "story_reel" } : { width: 1280, height: 720, key: "youtube_thumbnail" };
      const { prompt } = await buildImagePrompt(db(), p.companyId, { prompt: `Video thumbnail for "${p.name}". ${hook ? `The hook: ${hook}.` : ""} ${textOf(p.steps, "concept").slice(0, 400)}`, category: "thumbnail", textSpace: "top", aspect: p.aspect });
      const r = await generateImage(p.organizationId, p.companyId, { prompt, size: sizeFor(preset.width, preset.height), n: 1 });
      if (!r.ok) {
        if (r.code === "not_connected") throw new StepBlocked("Connect an image provider (OpenAI, Stability or Replicate) in Integrations, or skip the thumbnail.");
        throw new Error(r.error);
      }
      const saved = await saveVisual(ctx, p.organizationId, p.companyId, { stored: r.data.images[0]!, kind: "IMAGE", name: `${p.name} — thumbnail`, prompt, provider: r.providerId, model: r.data.model, width: preset.width, height: preset.height, preset: preset.key, category: "thumbnail", role: "thumbnail", costMicros: r.data.estimatedCostMicros, operation: "generate", projectId: p.id, campaignId: p.campaignId });
      await recordUsage(p.organizationId, "image.generations", 1, { companyId: p.companyId, idempotencyKey: saved.id });
      return { status: "SUCCEEDED", provider: r.providerId, costMicros: r.data.estimatedCostMicros, output: { assetId: saved.id, marketingAssetId: saved.marketingAssetId } };
    }

    case "variants": {
      const others = VIDEO_ASPECTS.filter((a) => a !== p.aspect);
      const results: Record<string, unknown>[] = [];
      let cost = 0;
      let waiting = false;
      for (const aspect of others) {
        const r = await assemble(p, ctx, settings, aspect, "variants");
        results.push({ aspect, ...(r.output ?? {}) });
        cost += r.costMicros ?? 0;
        if (r.status === "WAITING_PROVIDER") waiting = true;
      }
      return { status: waiting ? "WAITING_PROVIDER" : "SUCCEEDED", costMicros: cost || null, nextPollAt: waiting ? pollAt(20) : null, output: { variants: results, jobs: results.flatMap((r) => (Array.isArray(r.jobs) ? r.jobs : [])) } };
    }

    case "review": {
      await transaction(async (tx) => {
        await tx.creativeProject.update({ where: { id: p.id }, data: { status: "IN_REVIEW" } });
        const users = await usersWithPermission(tx, p.organizationId, p.companyId, "marketing.manage");
        await notifyUsers(tx, p.organizationId, users, "creative.review_requested", { title: p.name, href: `/studio/projects/${p.id}`, companyId: p.companyId });
      });
      throw new StepBlocked("Waiting for a person to approve the video.", "NEEDS_INPUT");
    }

    case "export":
      return exportPackage(p, ctx);

    case "handoff":
      throw new StepBlocked("Choose the social accounts and the post text to hand the video to marketing publishing.", "NEEDS_INPUT");
  }
}

// ───────────── Scene assets ─────────────

async function generateSceneAssets(p: ProjectRow, ctx: RequestContext, actx: RequestContext | null): Promise<StepResult> {
  if (!p.scenes.length) throw new StepBlocked("Create the storyboard first.", "NEEDS_INPUT");
  const settings = readSettings(p.settings);
  const todo = p.scenes.filter((s) => s.status !== "READY" && s.status !== "GENERATING");
  const images = todo.filter((s) => s.media !== "video");
  const clips = todo.filter((s) => s.media === "video");
  if (images.length) await assertLimit(actx, p.organizationId, "image.generations.month", images.length);
  if (clips.length) await assertLimit(actx, p.organizationId, "video.generations.month", clips.length);
  const size = ASPECT_SIZE[(VIDEO_ASPECTS as readonly string[]).includes(p.aspect) ? (p.aspect as VideoAspect) : "9:16"];
  const kit = await loadBrandKit(db(), p.companyId);
  const look = textOf(p.steps, "concept").slice(0, 400);
  let cost = 0;
  const errors: string[] = [];
  let blocked: string | null = null;
  for (const s of todo) {
    const prompt = [s.shot, look ? `Visual style: ${look}` : "", ...brandLines(kit), "No text, captions or watermarks in frame."].filter(Boolean).join(" ").slice(0, 3800);
    if (s.media !== "video") {
      const r = await generateImage(p.organizationId, p.companyId, { prompt, size: sizeFor(size.width, size.height), n: 1 });
      if (!r.ok) {
        if (r.code === "not_connected") blocked = "Connect an image provider (OpenAI, Stability or Replicate) in Integrations to create scene images.";
        else errors.push(`Scene ${s.position}: ${r.error}`);
        await db().creativeScene.update({ where: { id: s.id }, data: { status: r.code === "not_connected" ? "DRAFT" : "FAILED", error: r.error.slice(0, 300) } });
        if (r.code === "not_connected") break;
        continue;
      }
      const saved = await saveVisual(ctx, p.organizationId, p.companyId, { stored: r.data.images[0]!, kind: "IMAGE", name: `${p.name} — scene ${s.position}`, prompt: s.shot, provider: r.providerId, model: r.data.model, width: size.width, height: size.height, preset: p.aspect, category: "scene", role: "scene", costMicros: r.data.estimatedCostMicros, operation: "generate", projectId: p.id, sceneId: s.id, campaignId: p.campaignId });
      await recordUsage(p.organizationId, "image.generations", 1, { companyId: p.companyId, idempotencyKey: saved.id });
      cost += r.data.estimatedCostMicros ?? 0;
      await db().creativeScene.update({ where: { id: s.id }, data: { status: "READY", assetId: saved.marketingAssetId, provider: r.providerId, error: null, costMicros: toBig(r.data.estimatedCostMicros) } });
    } else {
      // Image-to-video from the scene's existing still when there is one.
      const still = s.assetId ? (await marketingAssetsById(p.organizationId, p.companyId, [s.assetId])).get(s.assetId) : null;
      const firstFrame = still && still.kind === "IMAGE" ? (await marketingAssetUrls(still)).publicUrl : null;
      const providers = settings.videoProvider ? [settings.videoProvider, ...CLIP_PROVIDERS.filter((v) => v !== settings.videoProvider)] : CLIP_PROVIDERS;
      const r = await startSceneClip(p.organizationId, p.companyId, { prompt, imageUrl: firstFrame, aspect: p.aspect as ClipAspect, seconds: s.seconds, providers });
      if (!r.ok) {
        if (r.code === "not_connected") blocked = "Connect a video provider (Runway, Luma, Kling or Replicate) in Integrations — or switch these scenes to images in the storyboard.";
        else errors.push(`Scene ${s.position}: ${r.error}`);
        await db().creativeScene.update({ where: { id: s.id }, data: { status: r.code === "not_connected" ? "DRAFT" : "FAILED", error: r.error.slice(0, 300) } });
        if (r.code === "not_connected") break;
        continue;
      }
      await recordUsage(p.organizationId, "video.generations", 1, { companyId: p.companyId, idempotencyKey: r.data.jobId });
      cost += r.data.estimatedCostMicros ?? 0;
      await db().creativeScene.update({ where: { id: s.id }, data: { status: "GENERATING", provider: r.data.provider, providerJobId: r.data.jobId, error: null, costMicros: toBig(r.data.estimatedCostMicros) } });
    }
  }
  const scenes = await db().creativeScene.findMany({ where: { projectId: p.id, companyId: p.companyId }, select: { status: true } });
  const generating = scenes.some((s) => s.status === "GENERATING");
  const ready = scenes.filter((s) => s.status === "READY").length;
  const output = { ready, total: scenes.length, errors };
  if (blocked && !generating) return { status: "BLOCKED", error: blocked, output, costMicros: cost || null };
  if (generating) return { status: "WAITING_PROVIDER", output, costMicros: cost || null, nextPollAt: pollAt(20), error: blocked };
  if (ready === scenes.length) return { status: "SUCCEEDED", output, costMicros: cost || null };
  return { status: "FAILED", output, error: errors[0] ?? "Some scenes have no media", costMicros: cost || null };
}

// ───────────── Assembly / variants / export ─────────────

interface RenderJob {
  aspect: string;
  jobId: string;
  provider: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  assetId: string | null;
  url: string | null;
  error: string | null;
}

async function signedOf(p: ProjectRow, assetId: unknown, days = 7): Promise<{ assetId: string; src: string } | null> {
  if (!isUuid(assetId)) return null;
  const a = await db().creativeAsset.findFirst({ where: { id: assetId, companyId: p.companyId }, select: { id: true, storageRef: true, url: true } });
  if (!a) return null;
  if (a.storageRef) {
    const r = await getSignedUrl(p.organizationId, p.companyId, a.storageRef, days * 86_400);
    return r.ok ? { assetId: a.id, src: r.data.url } : null;
  }
  return a.url ? { assetId: a.id, src: a.url } : null;
}

async function assemble(p: ProjectRow, ctx: RequestContext, settings: PipelineSettings, aspect: VideoAspect, role: "assembly" | "variants"): Promise<StepResult> {
  const fresh = await db().creativeScene.findMany({ where: { projectId: p.id, companyId: p.companyId }, orderBy: { position: "asc" } });
  if (!fresh.length) throw new StepBlocked("Create the storyboard first.", "NEEDS_INPUT");
  const library = await marketingAssetsById(p.organizationId, p.companyId, fresh.map((s) => s.assetId));
  const scenes = await Promise.all(
    fresh.map(async (s) => {
      const m = s.assetId ? library.get(s.assetId) : null;
      const url = m && m.status === "READY" ? (await marketingAssetUrls(m)).publicUrl : null;
      return { position: s.position, title: s.title, seconds: s.seconds, media: (m?.kind === "VIDEO" ? "video" : "image") as "image" | "video", assetId: s.assetId, url, narration: s.narration, onScreenText: s.onScreenText };
    }),
  );
  const step = (k: PipelineStep) => p.steps.find((s) => s.key === k);
  const vo = step("voiceover")?.status === "SUCCEEDED" ? outputOf(p.steps, "voiceover") : null;
  const voFile = vo ? await signedOf(p, vo.assetId) : null;
  const music = step("music")?.status === "SUCCEEDED" ? outputOf(p.steps, "music") : null;
  const musicFile = music ? await signedOf(p, music.assetId) : null;
  const caps = step("captions")?.status === "SUCCEEDED" ? outputOf(p.steps, "captions") : null;
  const cues = Array.isArray(caps?.cues) ? (caps.cues as Cue[]) : [];
  const size = ASPECT_SIZE[aspect];
  const timeline: EditTimeline = buildTimeline({
    aspect,
    width: size.width,
    height: size.height,
    scenes,
    voiceover: voFile && typeof vo?.duration === "number" ? { assetId: voFile.assetId, src: voFile.src, duration: vo.duration } : null,
    music: musicFile ? { assetId: musicFile.assetId, src: musicFile.src, license: typeof (music?.license as { licenseUrl?: string } | null)?.licenseUrl === "string" ? (music!.license as { licenseUrl: string }).licenseUrl : null } : null,
    cues,
  });
  // Editable timeline package (JSON + EDL), always produced.
  const by = actorId(ctx, p.organizationId);
  const [tj, edl] = await Promise.all([
    putObject(p.organizationId, p.companyId, { key: newObjectKey("creative-timelines", "json"), body: new TextEncoder().encode(JSON.stringify(timeline, null, 2)), contentType: "application/json" }),
    putObject(p.organizationId, p.companyId, { key: newObjectKey("creative-timelines", "edl"), body: new TextEncoder().encode(toEdl(timeline, `${p.name} ${aspect}`)), contentType: "text/plain" }),
  ]);
  if (!tj.ok || !edl.ok) throw new Error("the timeline could not be stored");
  const base = { organizationId: p.organizationId, companyId: p.companyId, kind: "TIMELINE" as const, projectId: p.id, campaignId: p.campaignId, operation: "generate", createdById: by, preset: aspect };
  const [timelineAsset, edlAsset] = await Promise.all([
    db().creativeAsset.create({ data: { ...base, name: `${p.name} ${aspect} timeline.json`, storageRef: tj.data.ref, mimeType: "application/json", sizeBytes: tj.data.size, role: role === "assembly" ? "timeline" : "variant_timeline" }, select: { id: true } }),
    db().creativeAsset.create({ data: { ...base, name: `${p.name} ${aspect}.edl`, storageRef: edl.data.ref, mimeType: "text/plain", sizeBytes: edl.data.size, role: role === "assembly" ? "edl" : "variant_edl" }, select: { id: true } }),
  ]);
  const output: Record<string, unknown> = { aspect, duration: timeline.duration, timelineAssetId: timelineAsset.id, edlAssetId: edlAsset.id, missing: timeline.missing, rendered: false, jobs: [] as RenderJob[] };
  if (timeline.missing.length) return { status: role === "assembly" ? "FAILED" : "SUCCEEDED", output: { ...output, note: "media_missing" }, error: role === "assembly" ? `Media missing for ${timeline.missing.join(", ")} — generate scene assets first.` : null };

  const renderTimeline: RenderTimeline = {
    aspect,
    width: size.width,
    height: size.height,
    duration: timeline.duration,
    clips: timeline.tracks.video.map((v) => ({ type: v.media, src: v.src!, start: v.start, length: v.length })),
    voiceover: timeline.tracks.voiceover?.src ? { src: timeline.tracks.voiceover.src, length: timeline.tracks.voiceover.length } : null,
    music: timeline.tracks.music?.src ? { src: timeline.tracks.music.src, volume: timeline.tracks.music.volume } : null,
    captions: cues.map((c) => ({ text: c.text, start: c.start, end: c.end })),
  };
  const providers: RenderProvider[] = settings.renderProvider ? [settings.renderProvider, ...RENDER_PROVIDERS.filter((r) => r !== settings.renderProvider)] : [...RENDER_PROVIDERS];
  try {
    await assertLimit(null, p.organizationId, "video.generations.month", 1);
  } catch (err) {
    if (role === "variants") return { status: "SUCCEEDED", output: { ...output, note: "render_limit_reached" } };
    throw err;
  }
  const r = await startRender(p.organizationId, p.companyId, renderTimeline, providers);
  if (!r.ok) {
    if (r.code === "not_connected") return { status: "SUCCEEDED", output: { ...output, note: "render_requires_provider" } };
    if (role === "variants") return { status: "SUCCEEDED", output: { ...output, note: "render_failed", renderError: r.error } };
    throw new Error(r.error);
  }
  await recordUsage(p.organizationId, "video.generations", 1, { companyId: p.companyId, idempotencyKey: r.data.jobId });
  const job: RenderJob = { aspect, jobId: r.data.jobId, provider: r.data.provider, status: "PENDING", assetId: null, url: null, error: null };
  return { status: "WAITING_PROVIDER", provider: r.data.provider, providerJobId: r.data.jobId, costMicros: r.data.estimatedCostMicros, nextPollAt: pollAt(20), output: { ...output, jobs: [job] } };
}

async function exportPackage(p: ProjectRow, ctx: RequestContext): Promise<StepResult> {
  if (p.status !== "APPROVED" && p.status !== "EXPORTED") throw new StepBlocked("The video must be approved before export.", "NEEDS_INPUT");
  const assets = await db().creativeAsset.findMany({ where: { projectId: p.id, companyId: p.companyId, archivedAt: null }, orderBy: { createdAt: "asc" } });
  const library = await marketingAssetsById(p.organizationId, p.companyId, assets.map((a) => a.marketingAssetId));
  const files = await Promise.all(
    assets.map(async (a) => {
      const m = a.marketingAssetId ? library.get(a.marketingAssetId) : null;
      const url = m ? (await marketingAssetUrls(m)).publicUrl : a.storageRef ? ((r) => (r.ok ? r.data.url : null))(await getSignedUrl(p.organizationId, p.companyId, a.storageRef, 7 * 86_400)) : a.url;
      return { id: a.id, role: a.role, kind: a.kind, name: a.name, aspect: a.preset, url, license: a.license ?? null };
    }),
  );
  const assembly = outputOf(p.steps, "assembly");
  const renders = files.filter((f) => f.role === "render");
  const manifest = {
    project: { id: p.id, name: p.name, aspect: p.aspect, platforms: p.platforms, approvedAt: p.approvedAt?.toISOString() ?? null },
    finishedVideo: renders.length > 0,
    note: renders.length ? null : "No server-side render: the package contains the editable timeline (JSON + EDL), scene media, voiceover, music and captions. Rendering requires a rendering provider (Shotstack or Creatomate).",
    renders,
    timeline: assembly?.timelineAssetId ?? null,
    files,
    script: textOf(p.steps, "script"),
    generatedAt: new Date().toISOString(),
  };
  const stored = await putObject(p.organizationId, p.companyId, { key: newObjectKey("creative-exports", "json"), body: new TextEncoder().encode(JSON.stringify(manifest, null, 2)), contentType: "application/json" });
  if (!stored.ok) throw new Error(`the export could not be stored: ${stored.error}`);
  const doc = await db().creativeAsset.create({ data: { organizationId: p.organizationId, companyId: p.companyId, kind: "DOCUMENT", name: `${p.name} — export manifest.json`, storageRef: stored.data.ref, mimeType: "application/json", sizeBytes: stored.data.size, role: "export", projectId: p.id, campaignId: p.campaignId, operation: "generate", createdById: actorId(ctx, p.organizationId) }, select: { id: true } });
  await db().creativeProject.update({ where: { id: p.id }, data: { status: "EXPORTED", exportedAt: new Date() } });
  return { status: "SUCCEEDED", output: { manifestAssetId: doc.id, files: files.length, finishedVideo: manifest.finishedVideo } };
}

// ───────────── Running steps ─────────────

async function persist(stepId: string, r: StepResult) {
  const final = r.status === "SUCCEEDED" || r.status === "FAILED" || r.status === "SKIPPED";
  await db().creativeStep.update({
    where: { id: stepId },
    data: {
      status: r.status,
      ...(r.output !== undefined ? { output: r.output === null ? undefined : json(r.output) } : {}),
      error: r.error ?? null,
      provider: r.provider ?? undefined,
      providerJobId: r.providerJobId ?? undefined,
      nextPollAt: r.nextPollAt ?? null,
      finishedAt: final ? new Date() : null,
      edited: false,
    },
  });
  if (r.costMicros) {
    const s = await db().creativeStep.findUnique({ where: { id: stepId }, select: { costMicros: true } });
    await db().creativeStep.update({ where: { id: stepId }, data: { costMicros: addMicros(s?.costMicros, r.costMicros) } });
  }
}

/** Run one step (claimed atomically). Returns the step's new state; plan-limit errors are re-thrown for the upgrade prompt. */
async function runStepInternal(p: ProjectRow, key: PipelineStep, actx: RequestContext | null, opts: { rerun?: boolean } = {}) {
  const step = p.steps.find((s) => s.key === key);
  if (!step) throw notFound("Step");
  if (!depsDone(p, key)) throw conflict("Earlier steps must finish first", { reason: "creative_step_waiting" });
  const allowed: CreativeStepStatus[] = opts.rerun ? [...RUNNABLE, "SUCCEEDED", "SKIPPED"] : RUNNABLE;
  const claim = await db().creativeStep.updateMany({ where: { id: step.id, status: { in: allowed } }, data: { status: "RUNNING", attempts: { increment: 1 }, startedAt: new Date(), error: null } });
  if (!claim.count) throw conflict("This step is already running or finished", { reason: "creative_step_busy" });
  if (opts.rerun && DONE.includes(step.status)) await markStale(p.id, p.companyId, key);
  if (key === "scene_assets" && opts.rerun) await db().creativeScene.updateMany({ where: { projectId: p.id, companyId: p.companyId, status: { in: ["READY", "FAILED"] } }, data: { status: "DRAFT", assetId: null } });
  if (p.status === "DRAFT") await db().creativeProject.update({ where: { id: p.id }, data: { status: "IN_PROGRESS" } });
  const fresh = opts.rerun && key === "scene_assets" ? await loadProject(p.organizationId, p.companyId, p.id) : p;
  try {
    const r = await execute(fresh, { ...step, status: "RUNNING" }, actx);
    await persist(step.id, r);
    return { key, status: r.status, error: r.error ?? null };
  } catch (err) {
    if (err instanceof StepBlocked) {
      await persist(step.id, { status: err.status, error: err.message });
      return { key, status: err.status, error: err.message };
    }
    const planError = err instanceof AppError && err.code === "not_available";
    const message = err instanceof Error ? err.message.slice(0, 500) : "step failed";
    await persist(step.id, { status: planError || (err instanceof AppError && err.code === "not_configured") ? "BLOCKED" : "FAILED", error: message });
    if (planError && actx) throw err;
    logger.warn({ projectId: p.id, step: key, err: message }, "creative step failed");
    return { key, status: planError ? "BLOCKED" : "FAILED", error: message };
  }
}

export async function stepAction(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, key: string, raw: z.input<typeof stepActionInput>) {
  const input = stepActionInput.parse(raw);
  if (!isUuid(projectId) || !(PIPELINE_STEPS as readonly string[]).includes(key)) throw notFound("Step");
  const k = key as PipelineStep;
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const p = await loadProject(organizationId, companyId, projectId);
  const step = p.steps.find((s) => s.key === k)!;
  let result: { key: string; status: string; error: string | null };
  if (input.action === "skip") {
    if (!SKIPPABLE.includes(k)) throw invalid("This step cannot be skipped", { reason: "creative_step_required" });
    if (step.status === "RUNNING" || step.status === "WAITING_PROVIDER") throw conflict("This step is running", { reason: "creative_step_busy" });
    await db().creativeStep.update({ where: { id: step.id }, data: { status: "SKIPPED", error: null, finishedAt: new Date(), nextPollAt: null } });
    await markStale(p.id, companyId, k);
    result = { key: k, status: "SKIPPED", error: null };
  } else if (input.action === "edit") {
    if (!EDITABLE.includes(k)) throw invalid("This step's result cannot be edited", { reason: "creative_step_not_editable" });
    if (step.status === "RUNNING") throw conflict("This step is running", { reason: "creative_step_busy" });
    const prev = (step.output ?? {}) as Record<string, unknown>;
    await db().creativeStep.update({ where: { id: step.id }, data: { status: "SUCCEEDED", output: json({ ...prev, text: input.text }), edited: true, error: null, finishedAt: new Date() } });
    await markStale(p.id, companyId, k);
    result = { key: k, status: "SUCCEEDED", error: null };
  } else {
    result = await runStepInternal(p, k, ctx, { rerun: input.action === "rerun" });
  }
  await transaction((tx) => writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `creative.step.${input.action}`, resourceType: "creative_project", resourceId: projectId, newValue: { step: k, status: result.status } }));
  return result;
}

/** Storyboard editor: replace the scene list (scenes whose shot or media changed lose their generated media). */
export async function saveScenes(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, raw: z.input<typeof saveScenesInput>) {
  const input = saveScenesInput.parse(raw);
  if (!isUuid(projectId)) throw notFound("Project");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const p = await tx.creativeProject.findFirst({ where: { id: projectId, organizationId, companyId, archivedAt: null, kind: "VIDEO" }, include: { scenes: true } });
    if (!p) throw notFound("Project");
    if (p.scenes.some((s) => s.status === "GENERATING")) throw conflict("Scenes are being generated — wait for them to finish", { reason: "creative_scenes_busy" });
    const prev = new Map(p.scenes.map((s) => [s.id, s]));
    await tx.creativeScene.deleteMany({ where: { projectId, companyId } });
    await tx.creativeScene.createMany({
      data: input.scenes.map((s, i) => {
        const old = s.id ? prev.get(s.id) : undefined;
        const keep = !!old && old.shot === s.shot && old.media === s.media;
        return { organizationId, companyId, projectId, position: i + 1, title: s.title, shot: s.shot, narration: s.narration, onScreenText: s.onScreenText ?? null, seconds: s.seconds, media: s.media, status: keep ? old.status : "DRAFT", assetId: keep ? old.assetId : null, provider: keep ? old.provider : null, costMicros: keep ? old.costMicros : null };
      }),
    });
    await tx.creativeStep.updateMany({ where: { projectId, companyId, key: "storyboard" }, data: { status: "SUCCEEDED", edited: true, finishedAt: new Date(), error: null } });
    await tx.creativeStep.updateMany({ where: { projectId, companyId, key: { in: downstream("storyboard") }, status: { in: ["SUCCEEDED", "NEEDS_INPUT"] } }, data: { status: "PENDING" } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "creative.storyboard.saved", resourceType: "creative_project", resourceId: projectId, newValue: { scenes: input.scenes.length } });
    return { ok: true, scenes: input.scenes.length };
  });
}

/** Approve the video or request changes (review step). */
export async function reviewProject(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, raw: z.input<typeof reviewInput>) {
  const input = reviewInput.parse(raw);
  if (!isUuid(projectId)) throw notFound("Project");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const p = await tx.creativeProject.findFirst({ where: { id: projectId, organizationId, companyId, archivedAt: null }, include: { steps: true } });
    if (!p) throw notFound("Project");
    const review = p.steps.find((s) => s.key === "review");
    if (!review || review.status !== "NEEDS_INPUT") throw conflict("The video is not waiting for review", { reason: "creative_not_in_review" });
    if (input.decision === "approve") {
      await tx.creativeStep.update({ where: { id: review.id }, data: { status: "SUCCEEDED", output: json({ decision: "approved", note: input.note ?? null, by: ctx.actor.id }), finishedAt: new Date(), error: null } });
      await tx.creativeProject.update({ where: { id: projectId }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: ctx.actor.id, reviewNote: input.note ?? null } });
    } else {
      await tx.creativeStep.update({ where: { id: review.id }, data: { status: "PENDING", output: json({ decision: "changes_requested", note: input.note ?? null, by: ctx.actor.id }), error: input.note ?? null } });
      await tx.creativeProject.update({ where: { id: projectId }, data: { status: "IN_PROGRESS", reviewNote: input.note ?? null } });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `creative.review.${input.decision}`, resourceType: "creative_project", resourceId: projectId, newValue: { note: input.note } });
    await emitCreativeEvent(tx, ctx, input.decision === "approve" ? "creative.video_approved" : "creative.changes_requested", { organizationId, companyId, entityType: "creative_project", entityId: projectId, data: { name: p.name } });
    if (p.createdById !== ctx.actor.id) await notifyUsers(tx, organizationId, [p.createdById], input.decision === "approve" ? "creative.approved" : "creative.changes_requested", { title: p.name, href: `/studio/projects/${p.id}`, companyId });
    return { ok: true };
  });
}

/** Licensed music: a person's upload (with a license attestation) or a track from a connected licensed source. */
export async function setMusic(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, raw: z.input<typeof musicInput>) {
  const input = musicInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const p = await loadProject(organizationId, companyId, projectId);
  let bytes: Buffer;
  let mimeType: string;
  let name: string;
  let license: Record<string, unknown>;
  if (input.source === "upload") {
    bytes = Buffer.from(input.dataBase64.replace(/^data:[^,]+,/, ""), "base64");
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw invalid("Music file must be 1 byte to 20 MB", { reason: "creative_music_size" });
    mimeType = input.mimeType === "audio/mp3" ? "audio/mpeg" : input.mimeType;
    name = input.name;
    license = { source: "upload", note: input.licenseNote, attribution: input.attribution ?? null, attestedById: ctx.actor.id, attestedAt: new Date().toISOString() };
  } else {
    const r = await searchLicensedMusic(organizationId, companyId, "", { id: input.trackId, limit: 1 });
    if (!r.ok) throw serviceFailure(r, "Licensed music", "creative_music");
    const t = r.data.tracks[0];
    if (!t) throw notFound("Licensed track");
    const d = await download(t.audioUrl, 20 * 1024 * 1024).catch(() => null);
    if (!d) throw conflict("The track could not be downloaded from the licensed source", { reason: "creative_music_download_failed" });
    bytes = d.bytes;
    mimeType = d.mimeType.startsWith("audio/") ? d.mimeType : "audio/mpeg";
    name = `${t.title} — ${t.artist}`;
    license = { source: "jamendo", trackId: t.id, licenseUrl: t.licenseUrl, attribution: t.attribution, pageUrl: t.pageUrl, selectedById: ctx.actor.id, selectedAt: new Date().toISOString() };
  }
  const stored = await putObject(organizationId, companyId, { key: newObjectKey("creative-music", mimeType.includes("wav") ? "wav" : mimeType.includes("ogg") ? "ogg" : "mp3"), body: new Uint8Array(bytes), contentType: mimeType });
  if (!stored.ok) throw serviceFailure(stored, "Storage", "creative_storage");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    await tx.creativeAsset.updateMany({ where: { projectId: p.id, companyId, role: "music", archivedAt: null }, data: { archivedAt: new Date() } });
    const a = await tx.creativeAsset.create({ data: { organizationId, companyId, kind: "AUDIO", name, storageRef: stored.data.ref, mimeType, sizeBytes: stored.data.size, role: "music", projectId: p.id, campaignId: p.campaignId, license: json(license), operation: input.source === "upload" ? "upload" : "license", createdById: actorId(ctx, organizationId) }, select: { id: true } });
    await tx.creativeStep.updateMany({ where: { projectId: p.id, companyId, key: "music" }, data: { status: "SUCCEEDED", output: json({ assetId: a.id, name, license }), error: null, finishedAt: new Date() } });
    await tx.creativeStep.updateMany({ where: { projectId: p.id, companyId, key: { in: downstream("music") }, status: { in: ["SUCCEEDED"] } }, data: { status: "PENDING" } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "creative.music.set", resourceType: "creative_asset", resourceId: a.id, newValue: license as Prisma.InputJsonValue });
    return { id: a.id };
  });
}

export async function musicSearch(ctx: RequestContext, organizationId: string, companyId: string, q: string) {
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const r = await searchLicensedMusic(organizationId, companyId, q);
  if (!r.ok) {
    if (r.code === "not_connected") return { connected: false, tracks: [] };
    throw serviceFailure(r, "Licensed music", "creative_music");
  }
  return { connected: true, tracks: r.data.tracks };
}

/**
 * Hand the approved video to marketing publishing: creates a DRAFT social post with the render (or thumbnail) in the
 * marketing composer. Scheduling and publishing stay in marketing (its approval / autonomy rules apply there).
 */
export async function handoffProject(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, raw: z.input<typeof handoffInput>) {
  const input = handoffInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const p = await loadProject(organizationId, companyId, projectId);
  if (p.status !== "APPROVED" && p.status !== "EXPORTED") throw conflict("Approve the video before handing it off", { reason: "creative_not_approved" });
  const media = await db().creativeAsset.findFirst({ where: { projectId: p.id, companyId, archivedAt: null, role: input.media === "render" ? "render" : "thumbnail", preset: input.media === "render" ? p.aspect : undefined, marketingAssetId: { not: null } }, orderBy: { createdAt: "desc" }, select: { marketingAssetId: true } });
  if (!media?.marketingAssetId) throw conflict(input.media === "render" ? "There is no finished render yet — rendering requires a rendering provider. Hand off the thumbnail or connect Shotstack / Creatomate." : "There is no thumbnail yet", { reason: input.media === "render" ? "creative_no_render" : "creative_no_thumbnail" });
  const post = await createPost(ctx, organizationId, companyId, { title: input.title, text: input.text, mediaAssetId: media.marketingAssetId, campaignId: p.campaignId, targets: input.accountIds.map((accountId) => ({ accountId })) });
  await transaction(async (tx) => {
    await tx.creativeStep.updateMany({ where: { projectId: p.id, companyId, key: "handoff" }, data: { status: "SUCCEEDED", output: json({ postId: (post as { id: string }).id, media: input.media }), error: null, finishedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "creative.handoff", resourceType: "creative_project", resourceId: p.id, newValue: { postId: (post as { id: string }).id } });
    await emitCreativeEvent(tx, ctx, "creative.handed_off", { organizationId, companyId, entityType: "creative_project", entityId: p.id, data: { postId: (post as { id: string }).id } });
  });
  return { postId: (post as { id: string }).id };
}

// ───────────── Worker ─────────────

async function storeOutput(p: { organizationId: string; companyId: string }, url: string): Promise<{ stored: Awaited<ReturnType<typeof putObject>> | null; mimeType: string }> {
  try {
    const d = await download(url, 50 * 1024 * 1024);
    const mimeType = d.mimeType.startsWith("video/") ? d.mimeType : "video/mp4";
    return { stored: await putObject(p.organizationId, p.companyId, { key: newObjectKey("creative-video", "mp4"), body: new Uint8Array(d.bytes), contentType: mimeType }), mimeType };
  } catch {
    return { stored: null, mimeType: "video/mp4" };
  }
}

/** Keep a provider video output: stored through storage, else referenced by its provider URL (marked as such). */
async function keepVideo(p: ProjectRow, url: string, meta: { name: string; role: string; provider: string; preset: string; sceneId?: string | null; costMicros?: number | null }) {
  const ctx = systemContext();
  const { stored, mimeType } = await storeOutput(p, url);
  if (stored?.ok) {
    return saveVisual(ctx, p.organizationId, p.companyId, { stored: stored.data, kind: "VIDEO", name: meta.name, prompt: null, provider: meta.provider, model: null, width: ASPECT_SIZE[meta.preset as VideoAspect]?.width ?? null, height: ASPECT_SIZE[meta.preset as VideoAspect]?.height ?? null, preset: meta.preset, category: meta.role === "scene" ? "scene" : "render", role: meta.role, costMicros: meta.costMicros ?? null, operation: meta.role === "scene" ? "generate" : "render", projectId: p.id, sceneId: meta.sceneId ?? null, campaignId: p.campaignId });
  }
  // Over the storage limit: keep the provider URL (short-lived at most providers — download it soon).
  return transaction(async (tx) => {
    const m = await tx.marketingAsset.create({ data: { organizationId: p.organizationId, companyId: p.companyId, kind: "VIDEO", status: "READY", name: meta.name, mimeType, url, preset: meta.preset, provider: meta.provider, campaignId: p.campaignId, createdById: p.createdById }, select: { id: true } });
    const a = await tx.creativeAsset.create({ data: { organizationId: p.organizationId, companyId: p.companyId, kind: "VIDEO", name: meta.name, marketingAssetId: m.id, url, mimeType, role: meta.role, preset: meta.preset, provider: meta.provider, projectId: p.id, sceneId: meta.sceneId ?? null, campaignId: p.campaignId, operation: meta.role === "scene" ? "generate" : "render", costMicros: toBig(meta.costMicros ?? null), createdById: p.createdById }, select: { id: true } });
    return { id: a.id, marketingAssetId: m.id };
  });
}

async function pollStep(step: StepRow & { project: ProjectRow }) {
  const p = step.project;
  const key = step.key as PipelineStep;
  if (key === "scene_assets") {
    for (const s of p.scenes.filter((x) => x.status === "GENERATING" && x.providerJobId)) {
      const r = await pollSceneClip(p.organizationId, p.companyId, s.providerJobId!);
      if (!r.ok) {
        if (r.code === "not_connected") await db().creativeScene.update({ where: { id: s.id }, data: { status: "FAILED", error: r.error } });
        continue;
      }
      if (r.data.status === "SUCCEEDED" && r.data.outputUrls[0]) {
        const saved = await keepVideo(p, r.data.outputUrls[0], { name: `${p.name} — scene ${s.position}`, role: "scene", provider: r.data.provider, preset: p.aspect, sceneId: s.id, costMicros: s.costMicros === null ? null : Number(s.costMicros) });
        await db().creativeScene.update({ where: { id: s.id }, data: { status: "READY", assetId: saved.marketingAssetId, error: null } });
      } else if (r.data.status === "FAILED" || r.data.status === "CANCELED" || Date.now() - s.updatedAt.getTime() > 6 * 3_600_000) {
        await db().creativeScene.update({ where: { id: s.id }, data: { status: "FAILED", error: (r.data.error ?? "timed out").slice(0, 300) } });
      }
    }
    const scenes = await db().creativeScene.findMany({ where: { projectId: p.id, companyId: p.companyId }, select: { status: true, position: true, error: true } });
    if (scenes.some((s) => s.status === "GENERATING")) return db().creativeStep.update({ where: { id: step.id }, data: { nextPollAt: pollAt(20) } });
    const failed = scenes.filter((s) => s.status !== "READY");
    const output = { ...((step.output ?? {}) as object), ready: scenes.length - failed.length, total: scenes.length, errors: failed.map((f) => `Scene ${f.position}: ${f.error ?? "no media"}`) };
    return persist(step.id, failed.length ? { status: "FAILED", output, error: output.errors[0] } : { status: "SUCCEEDED", output });
  }
  // assembly / variants: render jobs
  const out = (step.output ?? {}) as Record<string, unknown>;
  const jobs = (Array.isArray(out.jobs) ? out.jobs : []) as RenderJob[];
  for (const j of jobs.filter((x) => x.status === "PENDING" || x.status === "RUNNING")) {
    const r = await pollRender(p.organizationId, p.companyId, j.jobId);
    if (!r.ok) {
      if (r.code === "not_connected") Object.assign(j, { status: "FAILED", error: r.error });
      continue;
    }
    if (r.data.status === "SUCCEEDED" && r.data.outputUrls[0]) {
      const saved = await keepVideo(p, r.data.outputUrls[0], { name: `${p.name} — ${j.aspect}`, role: "render", provider: j.provider, preset: j.aspect });
      Object.assign(j, { status: "SUCCEEDED", assetId: saved.id, url: r.data.outputUrls[0] });
    } else if (r.data.status === "FAILED" || r.data.status === "CANCELED" || (step.startedAt && Date.now() - step.startedAt.getTime() > 6 * 3_600_000)) {
      Object.assign(j, { status: "FAILED", error: r.data.error ?? "timed out" });
    } else j.status = r.data.status;
  }
  const pending = jobs.some((j) => j.status === "PENDING" || j.status === "RUNNING");
  const failed = jobs.filter((j) => j.status === "FAILED");
  const rendered = jobs.some((j) => j.status === "SUCCEEDED");
  const output = { ...out, jobs, rendered, ...(key === "variants" && Array.isArray(out.variants) ? { variants: (out.variants as Record<string, unknown>[]).map((v) => ({ ...v, jobs: jobs.filter((j) => j.aspect === v.aspect) })) } : {}) };
  if (pending) return db().creativeStep.update({ where: { id: step.id }, data: { output: json(output), nextPollAt: pollAt(30) } });
  if (key === "assembly" && failed.length && !rendered) return persist(step.id, { status: "FAILED", output, error: `Render failed: ${failed[0]!.error ?? "unknown"}` });
  return persist(step.id, { status: "SUCCEEDED", output });
}

/** Worker tick: poll provider jobs, then advance auto-run projects one step each. */
export async function runCreativePipelines(): Promise<number> {
  let work = 0;
  const waiting = await db().creativeStep.findMany({ where: { status: "WAITING_PROVIDER", OR: [{ nextPollAt: null }, { nextPollAt: { lte: new Date() } }] }, take: 20, orderBy: { nextPollAt: "asc" } });
  for (const s of waiting) {
    try {
      const project = await db().creativeProject.findFirst({ where: { id: s.projectId, companyId: s.companyId }, include: { steps: { orderBy: { position: "asc" } }, scenes: { orderBy: { position: "asc" } } } });
      if (!project || project.archivedAt) {
        await db().creativeStep.update({ where: { id: s.id }, data: { status: "FAILED", error: "project archived", nextPollAt: null } });
        continue;
      }
      await pollStep({ ...s, project });
      work++;
    } catch (err) {
      logger.warn({ stepId: s.id, err: err instanceof Error ? err.message : String(err) }, "creative poll failed");
      await db().creativeStep.update({ where: { id: s.id }, data: { nextPollAt: pollAt(60) } }).catch(() => undefined);
    }
  }
  const c = await getControls();
  if (!c.aiWorkforceEnabled || c.aiExecutionPaused) return work;
  const auto = await db().creativeProject.findMany({ where: { autoAdvance: true, archivedAt: null, kind: "VIDEO", status: { in: ["DRAFT", "IN_PROGRESS", "APPROVED"] } }, take: 10, orderBy: { updatedAt: "asc" }, include: { steps: { orderBy: { position: "asc" } }, scenes: { orderBy: { position: "asc" } } } });
  for (const p of auto) {
    if (p.steps.some((s) => s.status === "RUNNING" || s.status === "WAITING_PROVIDER")) continue;
    if (await isCompanyAiPaused(p.organizationId, p.companyId)) continue;
    const next = PIPELINE_STEPS.find((k) => {
      const s = p.steps.find((x) => x.key === k);
      return s && s.status === "PENDING" && !MANUAL_ONLY.includes(k) && depsDone(p, k);
    });
    if (!next) continue;
    try {
      await runStepInternal(p, next, null);
      work++;
    } catch (err) {
      logger.warn({ projectId: p.id, step: next, err: err instanceof Error ? err.message : String(err) }, "creative auto-advance failed");
    }
    // Stop auto-advancing a project that needs a person.
    const after = await db().creativeStep.findFirst({ where: { projectId: p.id, companyId: p.companyId, key: next }, select: { status: true } });
    if (after && (["BLOCKED", "FAILED"].includes(after.status) || (after.status === "NEEDS_INPUT" && next !== "review"))) await db().creativeProject.update({ where: { id: p.id }, data: { autoAdvance: false } });
  }
  return work;
}

export { OPENAI_VOICES };
