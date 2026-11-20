import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { nextActions, runActionInput, runNextAction } from "@/server/modules/crm/next-actions";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({ data: await nextActions(ctx, orgId, companyId, { mine: req.nextUrl.searchParams.get("mine") === "1" }) }));

/** Do a suggested action (internal changes now; email actions only create a draft that waits for approval). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/next-actions", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => runNextAction(ctx, orgId, companyId, (await body(req, runActionInput)) as z.input<typeof runActionInput>),
);
