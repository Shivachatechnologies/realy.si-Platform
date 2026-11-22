import { z } from "zod";
import { db, Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { getControls } from "@/server/core/platform-controls";
import { redis } from "@/server/core/rate-limit";
import { emailConfigured } from "@/server/modules/email/service";
import { daysAgo, reasonSchema, requireAnyPlatform } from "./access";
import { setControl } from "./controls";

/**
 * Platform ops (stream E): maintenance toggle (existing control), email delivery log, cache/storage status,
 * failed-payment recovery. Security history and session management moved to ./security-access (F); AI routing,
 * AI errors and AI employee administration moved to ./ai-ops (C).
 */

// ───────────── Platform ops ─────────────

export async function opsOverview(ctx: RequestContext, raw: { emailStatus?: string } = {}) {
  await requireAnyPlatform(ctx, ["platform.controls.manage", "platform.security.read", "platform.subscriptions.read", "platform.audit.read"]);
  const status = ["SENT", "FAILED", "NOT_CONFIGURED"].includes(raw.emailStatus ?? "") ? (raw.emailStatus as "SENT" | "FAILED" | "NOT_CONFIGURED") : undefined;
  const t0 = Date.now();
  const [controls, emails, emailStats, redisInfo, dbSize, storage, storageObjects, failed] = await Promise.all([
    getControls(),
    db().emailMessage.findMany({ where: { ...(status ? { status } : {}) }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, organizationId: true, toEmail: true, template: true, locale: true, status: true, provider: true, error: true, createdAt: true } }),
    db().emailMessage.groupBy({ by: ["status"], where: { createdAt: { gte: daysAgo(7) } }, _count: { _all: true } }),
    (async () => {
      try {
        const r = redis();
        const start = Date.now();
        const pong = await r.ping();
        const latencyMs = Date.now() - start;
        const info = await r.info("memory").catch(() => "");
        const keys = await r.dbsize().catch(() => null);
        const used = /used_memory_human:(\S+)/.exec(info)?.[1] ?? null;
        return { ok: pong === "PONG", latencyMs, usedMemory: used, keys };
      } catch {
        return { ok: false, latencyMs: null, usedMemory: null, keys: null };
      }
    })(),
    db().$queryRaw<{ size: bigint }[]>(Prisma.sql`SELECT pg_database_size(current_database())::bigint AS size`).then((r) => Number(r[0]?.size ?? 0), () => null),
    db().integrationConnection.groupBy({ by: ["status"], where: { provider: "s3" }, _count: { _all: true } }).catch(() => [] as { status: string; _count: { _all: number } }[]),
    db().$queryRaw<{ n: bigint; bytes: bigint | null }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS n, SUM(size)::bigint AS bytes FROM integration_stored_objects`).then((r) => ({ count: Number(r[0]?.n ?? 0), bytes: Number(r[0]?.bytes ?? 0) }), () => null),
    db().subscription.findMany({
      where: { status: { in: ["PAST_DUE", "UNPAID", "INCOMPLETE"] } },
      orderBy: { lastPaymentFailedAt: "desc" },
      take: 100,
      select: { id: true, organizationId: true, status: true, currency: true, lastPaymentFailedAt: true, currentPeriodEnd: true, stripeSubscriptionId: true, plan: { select: { name: true } }, organization: { select: { name: true, billingProfile: { select: { stripeCustomerId: true } } } }, items: { select: { quantity: true, unitAmountMinor: true } } },
    }),
  ]);
  return {
    maintenance: { on: controls.maintenanceMode, readOnly: controls.readOnlyMode, message: controls.maintenanceMessage },
    email: { configured: emailConfigured(), log: emails, last7d: Object.fromEntries(emailStats.map((s) => [s.status, s._count._all])) as Record<string, number> },
    cache: redisInfo,
    database: { ok: true, sizeBytes: dbSize, checkMs: Date.now() - t0 },
    storage: { s3: Object.fromEntries(storage.map((s) => [s.status, s._count._all])) as Record<string, number>, dbFallback: storageObjects },
    failedPayments: failed.map((s) => ({
      id: s.id,
      organizationId: s.organizationId,
      organizationName: s.organization.name,
      status: s.status,
      plan: s.plan.name,
      amountMinor: s.items.reduce((a, i) => a + i.unitAmountMinor * BigInt(i.quantity), 0n),
      currency: s.currency,
      lastPaymentFailedAt: s.lastPaymentFailedAt,
      currentPeriodEnd: s.currentPeriodEnd,
      stripeUrl: s.stripeSubscriptionId ? `https://dashboard.stripe.com/subscriptions/${s.stripeSubscriptionId}` : s.organization.billingProfile?.stripeCustomerId ? `https://dashboard.stripe.com/customers/${s.organization.billingProfile.stripeCustomerId}` : null,
    })),
  };
}

export const maintenanceInput = z.object({ on: z.boolean(), reason: reasonSchema, confirm: z.string().max(100).optional() });

/** Maintenance mode toggle (the existing critical control; typed confirmation "maintenanceMode" to turn it on). */
export async function setMaintenance(ctx: RequestContext, raw: z.input<typeof maintenanceInput>) {
  const input = maintenanceInput.parse(raw);
  return setControl(ctx, { key: "maintenanceMode", value: input.on, reason: input.reason, confirm: input.confirm });
}
