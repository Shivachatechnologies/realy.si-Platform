import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { getKitView, startKit } from "@/server/modules/builder/kit";

type P = { orgId: string; companyId: string; runId: string };

/** GET — the run's Founder Kit (every deliverable with its status, content and structured part). */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, runId }) => ({ data: await getKitView(ctx, orgId, companyId, runId) }));

/** POST — create the Founder Kit for the run (only missing deliverables are added) and start what can start. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/builder/runs/:runId/kit", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, runId }) => startKit(ctx, orgId, companyId, runId),
);
