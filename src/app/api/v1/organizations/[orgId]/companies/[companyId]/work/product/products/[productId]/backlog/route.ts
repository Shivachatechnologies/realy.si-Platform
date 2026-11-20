import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { backlogTasksInput, createBacklogTasks, getBacklog } from "@/server/modules/work/product-delivery";

type P = { orgId: string; companyId: string; productId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, productId }) => getBacklog(ctx, orgId, companyId, productId));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/products/:productId/backlog", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, productId }) => createBacklogTasks(ctx, orgId, companyId, productId, await body(req, backlogTasksInput)));

