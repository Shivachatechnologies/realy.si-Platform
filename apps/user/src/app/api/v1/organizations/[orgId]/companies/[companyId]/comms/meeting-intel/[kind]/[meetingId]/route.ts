import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { notFound } from "@/server/core/errors";
import { draftInput, getMeetingIntel, kindParam, updateIntelDraft } from "@/server/modules/crm/meeting-intel";

type P = { orgId: string; companyId: string; kind: string; meetingId: string };

const k = (v: string) => kindParam(v) ?? (() => { throw notFound("Meeting"); })();

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, kind, meetingId }) => getMeetingIntel(ctx, orgId, companyId, k(kind), meetingId));
/** A person edits the AI draft (summary, action items, follow-up email). */
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/comms/meeting-intel/:kind/:meetingId", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, kind, meetingId }) => updateIntelDraft(ctx, orgId, companyId, k(kind), meetingId, await body(req, draftInput)),
);
