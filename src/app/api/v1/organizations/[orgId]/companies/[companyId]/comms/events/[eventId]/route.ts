import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteEvent, updateEvent, updateEventInput } from "@/server/modules/comms/calendar";

type P = { orgId: string; companyId: string; eventId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/comms/events/:eventId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, eventId }) => updateEvent(ctx, orgId, companyId, eventId, await body(req, updateEventInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/comms/events/:eventId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, eventId }) => deleteEvent(ctx, orgId, companyId, eventId),
);
