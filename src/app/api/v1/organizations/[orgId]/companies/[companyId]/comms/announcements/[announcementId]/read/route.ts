import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { markAnnouncementRead } from "@/server/modules/comms/announcements";

type P = { orgId: string; companyId: string; announcementId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/announcements/:announcementId/read", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, announcementId }) => markAnnouncementRead(ctx, orgId, companyId, announcementId),
);
