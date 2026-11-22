import { z } from "zod";
import { db, Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { processApp, type ProcessApp } from "@/server/core/observability";
import { pageInput, prismaPage, toPage } from "@/server/core/pagination";
import { requireAnyPlatform } from "./access";

/**
 * Releases and environment (stream E). The release of each process comes from the host's build metadata:
 *   Vercel (apps): VERCEL_GIT_COMMIT_SHA, VERCEL_GIT_COMMIT_REF, VERCEL_GIT_COMMIT_MESSAGE, VERCEL_ENV, VERCEL_DEPLOYMENT_ID,
 *                  VERCEL_URL ("Automatically expose System Environment Variables" must be on in the Vercel project)
 *   Worker:        APP_VERSION, GIT_SHA, RENDER_GIT_COMMIT or FLY_IMAGE_REF
 *   Deploy time:   DEPLOYED_AT or BUILD_TIME (ISO timestamp) when the pipeline sets one; otherwise unknown.
 * Every boot upserts one `platform_releases` row per (app, sha, environment). Nothing here deploys or rolls back.
 */

export const OBSERVE_PERMS = ["platform.controls.manage", "platform.security.read", "platform.audit.read", "platform.incidents.read", "platform.incidents.manage"];

export type DeployEnvironment = "production" | "preview" | "development";

/** production | preview | development: VERCEL_ENV on Vercel, else NODE_ENV (anything but production is development). */
export function deployEnvironment(): DeployEnvironment {
  const v = process.env.VERCEL_ENV;
  if (v === "production" || v === "preview" || v === "development") return v;
  const explicit = process.env.REALY_ENVIRONMENT;
  if (explicit === "production" || explicit === "preview" || explicit === "development") return explicit;
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

export const isProduction = () => deployEnvironment() === "production";

/**
 * Production safety for sensitive operations: in production the typed confirmation must be prefixed with
 * "PRODUCTION " (the dialog shows the exact phrase). Outside production the base phrase is enough.
 */
export function productionPhrase(base: string): string {
  return isProduction() ? `PRODUCTION ${base}` : base;
}

export function requireProductionConfirmation(given: string | undefined, base: string) {
  if ((given ?? "").trim() !== productionPhrase(base)) {
    throw invalid("Type the confirmation phrase exactly to continue", { reason: isProduction() ? "production_confirmation_required" : "confirmation_mismatch", phrase: productionPhrase(base) });
  }
}

export interface ReleaseInfo {
  app: ProcessApp;
  environment: DeployEnvironment;
  /** Full commit SHA, or null when the host exposes none. */
  sha: string | null;
  shortSha: string | null;
  ref: string | null;
  message: string | null;
  deploymentId: string | null;
  url: string | null;
  deployedAt: Date | null;
  /** Where the metadata came from: "vercel", "worker-env" or "none". */
  source: "vercel" | "worker-env" | "none";
}

const clean = (v: string | undefined, max = 200) => (v && v.trim() ? v.trim().slice(0, max) : null);

function deployTime(): Date | null {
  const raw = clean(process.env.DEPLOYED_AT) ?? clean(process.env.BUILD_TIME);
  if (!raw) return null;
  const d = new Date(/^\d+$/.test(raw) ? Number(raw) : raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The release this process runs (used by A's environment badge and error tagging). Never throws. */
export function releaseInfo(app: ProcessApp = processApp()): ReleaseInfo {
  const vercelSha = clean(process.env.VERCEL_GIT_COMMIT_SHA, 64);
  const workerSha = app === "worker" ? (clean(process.env.GIT_SHA, 64) ?? clean(process.env.RENDER_GIT_COMMIT, 64) ?? clean(process.env.APP_VERSION, 64) ?? clean(process.env.FLY_IMAGE_REF, 120)) : null;
  const sha = vercelSha ?? workerSha;
  return {
    app,
    environment: deployEnvironment(),
    sha,
    shortSha: sha ? (/^[0-9a-f]{12,}$/i.test(sha) ? sha.slice(0, 7) : sha.slice(0, 24)) : null,
    ref: clean(process.env.VERCEL_GIT_COMMIT_REF),
    message: clean(process.env.VERCEL_GIT_COMMIT_MESSAGE, 300)?.split("\n")[0] ?? null,
    deploymentId: clean(process.env.VERCEL_DEPLOYMENT_ID),
    url: clean(process.env.VERCEL_URL),
    deployedAt: deployTime(),
    source: vercelSha ? "vercel" : workerSha ? "worker-env" : "none",
  };
}

/** Short release label stored on error events ("a1b2c3d", or null). */
export const currentReleaseLabel = (app: ProcessApp = processApp()) => releaseInfo(app).shortSha;

const releaseStore = globalThis as unknown as { realyReleaseRecorded?: Set<string> };

/** Upsert this boot's release row (once per process and app). Best effort: never throws, never blocks startup long. */
export async function recordRelease(app: ProcessApp = processApp()): Promise<void> {
  releaseStore.realyReleaseRecorded ??= new Set();
  if (releaseStore.realyReleaseRecorded.has(app)) return;
  releaseStore.realyReleaseRecorded.add(app);
  const r = releaseInfo(app);
  const sha = r.sha ?? "unknown";
  try {
    await db().platformRelease.upsert({
      where: { app_sha_environment: { app, sha, environment: r.environment } },
      create: { app, sha, environment: r.environment, ref: r.ref, message: r.message, deploymentId: r.deploymentId, url: r.url, deployedAt: r.deployedAt },
      update: { lastSeenAt: new Date(), boots: { increment: 1 }, ...(r.deploymentId ? { deploymentId: r.deploymentId } : {}), ...(r.url ? { url: r.url } : {}) },
    });
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : String(err) }, "release recording skipped");
  }
}

export const releaseFilters = pageInput.extend({ app: z.enum(["user", "admin", "worker"]).optional(), environment: z.enum(["production", "preview", "development"]).optional() });

/** Release history (newest first) with error counts per release, plus the release each app runs now. */
export async function listReleases(ctx: RequestContext, raw: z.input<typeof releaseFilters> = {}) {
  await requireAnyPlatform(ctx, OBSERVE_PERMS);
  const f = releaseFilters.parse(raw);
  const rows = await db().platformRelease.findMany({
    where: { ...(f.app ? { app: f.app } : {}), ...(f.environment ? { environment: f.environment } : {}) },
    orderBy: { id: "desc" },
    ...prismaPage(f),
  });
  const page = toPage(rows, f);
  const shorts = [...new Set(page.data.map((r) => (/^[0-9a-f]{12,}$/i.test(r.sha) ? r.sha.slice(0, 7) : r.sha.slice(0, 24))))];
  const errorCounts = shorts.length
    ? await db().errorEvent.groupBy({ by: ["release"], where: { release: { in: shorts } }, _count: { _all: true } })
    : [];
  const errorsOf = new Map(errorCounts.map((e) => [e.release, e._count._all]));
  const latest = await db().$queryRaw<{ app: string; sha: string; environment: string; last_seen_at: Date }[]>(Prisma.sql`
    SELECT DISTINCT ON (app) app, sha, environment, last_seen_at FROM platform_releases ORDER BY app, last_seen_at DESC`);
  return {
    ...page,
    data: page.data.map((r) => {
      const short = /^[0-9a-f]{12,}$/i.test(r.sha) ? r.sha.slice(0, 7) : r.sha.slice(0, 24);
      return { ...r, shortSha: short, errors: errorsOf.get(short) ?? 0 };
    }),
    current: releaseInfo(),
    latestByApp: latest.map((l) => ({ app: l.app, sha: l.sha, environment: l.environment, lastSeenAt: l.last_seen_at })),
  };
}

/** One release: metadata, error groups first seen or seen in it, and health checks that failed in its first hour. */
export async function getRelease(ctx: RequestContext, id: string) {
  await requireAnyPlatform(ctx, OBSERVE_PERMS);
  if (!z.string().uuid().safeParse(id).success) return null;
  const r = await db().platformRelease.findUnique({ where: { id } });
  if (!r) return null;
  const short = /^[0-9a-f]{12,}$/i.test(r.sha) ? r.sha.slice(0, 7) : r.sha.slice(0, 24);
  const hourAfter = new Date(r.firstSeenAt.getTime() + 3_600_000);
  const [newGroups, byGroup, failures] = await Promise.all([
    db().errorGroup.findMany({ where: { firstRelease: short }, orderBy: { count: "desc" }, take: 20, select: { id: true, name: true, message: true, source: true, status: true, count: true, firstSeenAt: true } }),
    db().errorEvent.groupBy({ by: ["groupId"], where: { release: short }, _count: { _all: true }, orderBy: { _count: { groupId: "desc" } }, take: 20 }),
    db().serviceHealthCheck.findMany({ where: { checkedAt: { gte: r.firstSeenAt, lte: hourAfter }, status: { in: ["DOWN", "CRITICAL", "DEGRADED"] } }, orderBy: { checkedAt: "asc" }, take: 50, select: { id: true, service: true, status: true, checkedAt: true } }),
  ]);
  const groups = byGroup.length ? await db().errorGroup.findMany({ where: { id: { in: byGroup.map((g) => g.groupId) } }, select: { id: true, name: true, message: true, source: true, status: true } }) : [];
  const groupOf = new Map(groups.map((g) => [g.id, g]));
  return {
    release: { ...r, shortSha: short },
    newGroups,
    errorsByGroup: byGroup.map((g) => ({ group: groupOf.get(g.groupId) ?? null, groupId: g.groupId, count: g._count._all })),
    healthAfterDeploy: failures,
  };
}
