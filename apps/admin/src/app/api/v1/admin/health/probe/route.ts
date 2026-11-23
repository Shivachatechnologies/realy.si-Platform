import { LIMITS } from "@/server/core/limits";
import { conflict } from "@/server/core/errors";
import { route } from "@/server/core/http";
import { db } from "@/server/core/db";
import { requirePlatform } from "@/server/modules/admin/access";
import { runHealthProbes } from "@/server/modules/admin/health";

/**
 * Re-check every service now (platform.controls.manage). Refused when the last probe ran less than 2 minutes ago, so a
 * button cannot turn into a probe storm (third-party APIs and Redis are billed per call).
 */
export const POST = route({ auth: "required", name: "POST /admin/health/probe", rateLimits: LIMITS.admin }, async ({ ctx }) => {
  await requirePlatform(ctx, "platform.controls.manage");
  const last = await db().serviceHealthCheck.findFirst({ where: { service: "db" }, orderBy: { checkedAt: "desc" }, select: { checkedAt: true } });
  if (last && Date.now() - last.checkedAt.getTime() < 120_000) throw conflict("The services were checked less than 2 minutes ago", { reason: "probe_too_recent", checkedAt: last.checkedAt.toISOString() });
  return { written: await runHealthProbes({ force: true }) };
});
