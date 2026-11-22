import { z } from "zod";
import { db, Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { getControls } from "@/server/core/platform-controls";
import { redisConfigured } from "@/server/core/rate-limit";
import { reasonSchema, requireAnyPlatform } from "./access";
import { setControl } from "./controls";
import { redisInfo } from "./infra";
import { deployEnvironment, isProduction, productionPhrase, requireProductionConfirmation } from "./releases";

/**
 * Platform ops (stream E): maintenance toggle (existing control) plus cache, database and storage status. The email
 * delivery log moved to Admin → Email (stream F, /email) and the failed-payment recovery list to Admin → Payments
 * (stream D, /payments) per the Control Center map. Security history and sessions live in ./security-access (F); AI
 * routing and AI employee administration in ./ai-ops (C).
 */

export async function opsOverview(ctx: RequestContext) {
  await requireAnyPlatform(ctx, ["platform.controls.manage", "platform.security.read", "platform.subscriptions.read", "platform.audit.read"]);
  const t0 = Date.now();
  const [controls, cache, dbSize, storage, storageObjects] = await Promise.all([
    getControls(),
    // One INFO command, cached 5 minutes (infra.ts): no PING/DBSIZE per page view.
    redisInfo(),
    db().$queryRaw<{ size: bigint }[]>(Prisma.sql`SELECT pg_database_size(current_database())::bigint AS size`).then((r) => Number(r[0]?.size ?? 0), () => null),
    db().integrationConnection.groupBy({ by: ["status"], where: { provider: "s3" }, _count: { _all: true } }).catch(() => [] as { status: string; _count: { _all: number } }[]),
    db().$queryRaw<{ n: bigint; bytes: bigint | null }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS n, SUM(size)::bigint AS bytes FROM integration_stored_objects`).then((r) => ({ count: Number(r[0]?.n ?? 0), bytes: Number(r[0]?.bytes ?? 0) }), () => null),
  ]);
  return {
    environment: deployEnvironment(),
    maintenance: { on: controls.maintenanceMode, readOnly: controls.readOnlyMode, message: controls.maintenanceMessage, phrase: productionPhrase("maintenanceMode") },
    cache: { configured: redisConfigured(), ok: !!cache, usedMemory: cache?.usedMemory ?? null, keys: cache?.keys ?? null, clients: cache?.connectedClients ?? null, fetchedAt: cache?.fetchedAt ?? null },
    database: { ok: dbSize !== null, sizeBytes: dbSize, checkMs: Date.now() - t0 },
    storage: { s3: Object.fromEntries(storage.map((s) => [s.status, s._count._all])) as Record<string, number>, dbFallback: storageObjects },
  };
}

export const maintenanceInput = z.object({ on: z.boolean(), reason: reasonSchema, confirm: z.string().max(100).optional() });

/**
 * Maintenance mode toggle (the existing critical control). Turning it on needs the typed confirmation
 * "maintenanceMode"; in production "PRODUCTION maintenanceMode" (environment safety, stream E).
 */
export async function setMaintenance(ctx: RequestContext, raw: z.input<typeof maintenanceInput>) {
  const input = maintenanceInput.parse(raw);
  let confirm = input.confirm;
  if (input.on && isProduction()) {
    requireProductionConfirmation(confirm, "maintenanceMode");
    confirm = "maintenanceMode"; // the control's own check wants the bare key
  }
  return setControl(ctx, { key: "maintenanceMode", value: input.on, reason: input.reason, confirm });
}
