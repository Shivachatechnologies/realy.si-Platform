import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { calendarRange, createEvent, eventInput } from "@/server/modules/comms/calendar";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => calendarRange(ctx, orgId, companyId, new Date(req.nextUrl.searchParams.get("from") ?? Date.now()), new Date(req.nextUrl.searchParams.get("to") ?? Date.now() + 31 * 86_400_000), { mine: req.nextUrl.searchParams.get("mine") === "1" }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/events", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createEvent(ctx, orgId, companyId, await body(req, eventInput)),
);
