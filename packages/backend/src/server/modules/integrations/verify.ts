import "server-only";
import { db } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { dispatchJob, MODULE_JOBS_QUEUE } from "@/server/core/jobs";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { providerInfo } from "./catalog";
import { getConnection } from "./connections";
import { logProviderCall } from "./client";
import { ProviderError, testConnection } from "./providers";

/**
 * Scheduled connection health checks: every connection that has not been verified for a day (no successful test and no
 * successful provider call) is tested again with the provider's identity call. Rejected credentials (401/403) mark the
 * connection ERROR right away and notify the company's integration managers; transient failures (network, 429, 5xx)
 * only count toward the failure streak, so a provider hiccup never flips a working connection to "failing".
 * "Connected" in the UI therefore always means "verified with the provider within the last day or on connect".
 */

export const VERIFY_EVERY_MS = 24 * 3_600_000;

export type VerifyOutcome = "verified" | "rejected" | "transient" | "no_credentials" | "skipped";

/** Test one connection with its stored credentials (system context: no user permission involved). */
export async function verifyConnection(connectionId: string): Promise<VerifyOutcome> {
  const row = await db().integrationConnection.findUnique({ where: { id: connectionId } });
  if (!row || row.status === "DISCONNECTED" || !row.credentialsEnc) return "skipped";
  const info = providerInfo(row.provider);
  if (!info || info.authType === "none") return "skipped";
  // getConnection refreshes expiring OAuth tokens (and marks the connection ERROR when the refresh is refused).
  const conn = await getConnection(row.organizationId, row.companyId, row.provider);
  if (!conn?.accessToken) {
    await db().integrationConnection.update({ where: { id: row.id }, data: { lastTestedAt: new Date() } });
    if (row.status === "CONNECTED") await flipToError(row, "No usable credentials; reconnect the integration");
    return "no_credentials";
  }
  const started = Date.now();
  try {
    const r = await testConnection({ provider: row.provider, token: conn.accessToken, config: conn.config });
    await logProviderCall(conn, { method: "TEST", url: `${row.provider} · scheduled health check`, status: 200, durationMs: Date.now() - started, attempts: 1, requestSummary: "authenticated identity call", responseSummary: r.account ? "account verified" : "ok", error: null });
    await db().integrationConnection.update({
      where: { id: row.id },
      data: {
        status: "CONNECTED",
        lastError: null,
        lastErrorAt: null,
        lastTestedAt: new Date(),
        lastSuccessAt: new Date(),
        errorStreak: 0,
        externalAccount: r.account ?? row.externalAccount,
      },
    });
    return "verified";
  } catch (err) {
    const status = err instanceof ProviderError ? err.status : null;
    const message = (err instanceof Error ? err.message : "Connection test failed").slice(0, 300);
    await logProviderCall(conn, { method: "TEST", url: `${row.provider} · scheduled health check`, status, durationMs: Date.now() - started, attempts: 1, requestSummary: "authenticated identity call", responseSummary: null, error: message });
    const rejected = status === 401 || status === 403;
    await db().integrationConnection.update({
      where: { id: row.id },
      data: { lastTestedAt: new Date(), lastFailureAt: new Date(), ...(rejected ? {} : { errorStreak: { increment: 1 } }) },
    });
    if (rejected) {
      await flipToError(row, `The provider rejected the stored credentials (${status}): ${message}`);
      return "rejected";
    }
    return "transient";
  }
}

async function flipToError(row: { id: string; provider: string; organizationId: string; companyId: string; status: string }, message: string) {
  const { count } = await db().integrationConnection.updateMany({
    where: { id: row.id, status: { not: "DISCONNECTED" } },
    data: { status: "ERROR", lastError: message.slice(0, 500), lastErrorAt: new Date() },
  });
  if (!count || row.status !== "CONNECTED") return;
  try {
    const managers = await usersWithPermission(db(), row.organizationId, row.companyId, "integrations.manage");
    await notifyUsers(db(), row.organizationId, managers, "integrations.connection_failing", {
      companyId: row.companyId,
      title: providerInfo(row.provider)?.name ?? row.provider,
      href: `/integrations/${row.provider}`,
    });
  } catch (err) {
    logger.warn({ provider: row.provider, err: err instanceof Error ? err.message : "notify failed" }, "integration health notification failed");
  }
}

/** Periodic job: queue health checks for connections not verified within VERIFY_EVERY_MS (a bounded batch per tick). */
export async function runDueHealthChecks(limit = 25): Promise<number> {
  const cutoff = new Date(Date.now() - VERIFY_EVERY_MS);
  const due = await db().integrationConnection.findMany({
    where: {
      status: { in: ["CONNECTED", "ERROR"] },
      credentialsEnc: { not: null },
      provider: { not: "webhook" },
      AND: [{ OR: [{ lastTestedAt: null }, { lastTestedAt: { lt: cutoff } }] }, { OR: [{ lastSuccessAt: null }, { lastSuccessAt: { lt: cutoff } }] }],
    },
    orderBy: { lastTestedAt: { sort: "asc", nulls: "first" } },
    take: limit,
    select: { id: true, organizationId: true },
  });
  let n = 0;
  for (const c of due) {
    // Claim the slot first so a slow check is not queued twice by the next tick.
    const { count } = await db().integrationConnection.updateMany({ where: { id: c.id, OR: [{ lastTestedAt: null }, { lastTestedAt: { lt: cutoff } }] }, data: { lastTestedAt: new Date() } });
    if (!count) continue;
    const day = Math.floor(Date.now() / VERIFY_EVERY_MS);
    const queued = await dispatchJob(MODULE_JOBS_QUEUE, "integrations.verify_connection", { connectionId: c.id }, { jobId: `verify_${c.id}_${day}`, organizationId: c.organizationId });
    if (!queued) await verifyConnection(c.id).catch((err) => logger.warn({ connectionId: c.id, err: err instanceof Error ? err.message : "verify failed" }, "integration health check failed"));
    n++;
  }
  return n;
}
