import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteAnnouncement, getAnnouncement, updateAnnouncement, updateAnnouncementInput } from "@/server/modules/comms/announcements";

type P = { orgId: string; companyId: string; announcementId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, announcementId }) => getAnnouncement(ctx, orgId, companyId, announcementId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/comms/announcements/:announcementId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, announcementId }) => updateAnnouncement(ctx, orgId, companyId, announcementId, await body(req, updateAnnouncementInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/comms/announcements/:announcementId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, announcementId }) => deleteAnnouncement(ctx, orgId, companyId, announcementId),
);
