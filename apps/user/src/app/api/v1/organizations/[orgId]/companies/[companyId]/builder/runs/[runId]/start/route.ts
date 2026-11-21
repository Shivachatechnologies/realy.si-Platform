import { after } from "next/server";
import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { logger } from "@/server/core/logger";
import { advanceRun } from "@/server/modules/builder/engine";
import { startRun } from "@/server/modules/builder/service";

type P = { orgId: string; companyId: string; runId: string };

/** Start a draft (existing business) run. The website import runs after the response (and in the worker job). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/builder/runs/:runId/start", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, runId }) => {
    const r = await startRun(ctx, orgId, companyId, runId);
    after(() => advanceRun(runId).catch((err) => logger.warn({ runId, err: String(err) }, "builder advance after start failed")));
    return r;
  },
);
