import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addDependency, dependencyInput, removeDependency } from "@/server/modules/work/tasks";

type P = { orgId: string; companyId: string; taskId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/tasks/:taskId/dependencies", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, taskId }) => addDependency(ctx, orgId, companyId, taskId, await body(req, dependencyInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/work/tasks/:taskId/dependencies", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, taskId }) => removeDependency(ctx, orgId, companyId, taskId, req.nextUrl.searchParams.get("dependsOnId") ?? ""));
