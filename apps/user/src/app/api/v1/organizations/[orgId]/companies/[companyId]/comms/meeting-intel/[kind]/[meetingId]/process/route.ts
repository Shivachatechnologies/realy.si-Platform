import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { notFound } from "@/server/core/errors";
import { processTranscript, kindParam } from "@/server/modules/crm/meeting-intel";

type P = { orgId: string; companyId: string; kind: string; meetingId: string };

const k = (v: string) => kindParam(v) ?? (() => { throw notFound("Meeting"); })();

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/meeting-intel/:kind/:meetingId/process", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, kind, meetingId }) => processTranscript(ctx, orgId, companyId, k(kind), meetingId),
);
