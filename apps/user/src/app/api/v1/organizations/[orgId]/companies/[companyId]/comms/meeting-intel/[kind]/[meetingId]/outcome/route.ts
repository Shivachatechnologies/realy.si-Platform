import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { notFound } from "@/server/core/errors";
import { confirmMeetingOutcome, kindParam, outcomeInput } from "@/server/modules/crm/meeting-intel";

type P = { orgId: string; companyId: string; kind: string; meetingId: string };

const k = (v: string) => kindParam(v) ?? (() => { throw notFound("Meeting"); })();

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/meeting-intel/:kind/:meetingId/outcome", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, kind, meetingId }) => confirmMeetingOutcome(ctx, orgId, companyId, k(kind), meetingId, await body(req, outcomeInput)),
);
