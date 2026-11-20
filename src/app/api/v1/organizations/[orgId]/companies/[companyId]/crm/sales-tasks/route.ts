import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { invalid } from "@/server/core/errors";
import { createSalesTask, listSalesTasks, salesTaskInput, SALES_TASK_SOURCES, type SalesTaskSubject } from "@/server/modules/crm/tasks";

type P = { orgId: string; companyId: string };

/** GET ?type=deal|lead|account&id= */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const type = req.nextUrl.searchParams.get("type") as SalesTaskSubject;
  if (!Object.hasOwn(SALES_TASK_SOURCES, type ?? "")) throw invalid("Unknown record type");
  return { data: await listSalesTasks(ctx, orgId, companyId, type, req.nextUrl.searchParams.get("id") ?? "") };
});
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/sales-tasks", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createSalesTask(ctx, orgId, companyId, await body(req, salesTaskInput)),
);
