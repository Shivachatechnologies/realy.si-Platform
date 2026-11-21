import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createProcess, listProcesses, processInput } from "@/server/modules/work/operations";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listProcesses(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/operations/processes", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createProcess(ctx, orgId, companyId, await body(req, processInput)));
