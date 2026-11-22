import { LIMITS } from "@/server/core/limits";
import { notFound } from "@/server/core/errors";
import { body, route } from "@/server/core/http";
import {
  addIncidentNote,
  changeIncidentStatus,
  incidentNoteInput,
  incidentStatusInput,
  linkAlertsInput,
  linkAlertsToIncident,
  postmortemInput,
  savePostmortem,
} from "@/server/modules/admin/incidents";

/** POST /admin/incidents/:id/{status|notes|postmortem|alerts} (platform.incidents.manage). */
export const POST = route<{ id: string; action: string }>({ auth: "required", name: "POST /admin/incidents/:id/:action", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { id, action }) => {
  switch (action) {
    case "status":
      return changeIncidentStatus(ctx, id, await body(req, incidentStatusInput));
    case "notes":
      return addIncidentNote(ctx, id, await body(req, incidentNoteInput));
    case "postmortem":
      return savePostmortem(ctx, id, await body(req, postmortemInput));
    case "alerts":
      return linkAlertsToIncident(ctx, id, await body(req, linkAlertsInput));
    default:
      throw notFound("Action");
  }
});
