import "server-only";
import { db } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { providerInfo } from "./catalog";

/**
 * Connection health from real provider calls: last success / failure and the consecutive-failure streak. At
 * FAILURE_THRESHOLD consecutive failures a CONNECTED connection is marked ERROR and the company's integration managers
 * are notified once (the streak resets on the next success, which also clears the error).
 */

export const FAILURE_THRESHOLD = 5;

interface HealthTarget {
  id: string;
  provider: string;
}

/** Whether a call outcome says something about the connection's health (caller mistakes like 400/404/422 do not). */
export function healthSignal(status: number | null): "success" | "failure" | null {
  if (status === null) return "failure";
  if (status >= 200 && status < 400) return "success";
  if (status === 401 || status === 403 || status >= 500) return "failure";
  return null;
}

export async function recordCallSuccess(conn: HealthTarget): Promise<void> {
  try {
    const now = new Date();
    // One conditional write: skipped when the streak is already 0 and the last success was recorded within a minute.
    await db().integrationConnection.updateMany({
      where: { id: conn.id, OR: [{ errorStreak: { gt: 0 } }, { lastSuccessAt: null }, { lastSuccessAt: { lt: new Date(now.getTime() - 60_000) } }] },
      data: { lastSuccessAt: now, errorStreak: 0 },
    });
    await db().integrationConnection.updateMany({
      where: { id: conn.id, status: "ERROR", lastError: { startsWith: "Repeated failures" } },
      data: { status: "CONNECTED", lastError: null, lastErrorAt: null },
    });
  } catch (err) {
    logger.warn({ provider: conn.provider, err: err instanceof Error ? err.message : "health update failed" }, "integration health update failed");
  }
}

export async function recordCallFailure(conn: HealthTarget, error: string): Promise<void> {
  try {
    const row = await db().integrationConnection.update({
      where: { id: conn.id },
      data: { lastFailureAt: new Date(), errorStreak: { increment: 1 } },
      select: { errorStreak: true, status: true, organizationId: true, companyId: true },
    });
    if (row.errorStreak !== FAILURE_THRESHOLD || row.status !== "CONNECTED") return;
    const message = `Repeated failures (${FAILURE_THRESHOLD} in a row): ${error}`.slice(0, 500);
    const { count } = await db().integrationConnection.updateMany({ where: { id: conn.id, status: "CONNECTED" }, data: { status: "ERROR", lastError: message, lastErrorAt: new Date() } });
    if (!count) return;
    const managers = await usersWithPermission(db(), row.organizationId, row.companyId, "integrations.manage");
    await notifyUsers(db(), row.organizationId, managers, "integrations.connection_failing", {
      companyId: row.companyId,
      title: providerInfo(conn.provider)?.name ?? conn.provider,
      href: `/integrations/${conn.provider}`,
    });
  } catch (err) {
    logger.warn({ provider: conn.provider, err: err instanceof Error ? err.message : "health update failed" }, "integration health update failed");
  }
}

/** Record the outcome of a provider call by HTTP status (null = network error). */
export async function recordCallOutcome(conn: HealthTarget, status: number | null, error?: string | null): Promise<void> {
  const signal = healthSignal(status);
  if (signal === "success") await recordCallSuccess(conn);
  else if (signal === "failure") await recordCallFailure(conn, error ?? (status === null ? "network error" : `provider responded ${status}`));
}
