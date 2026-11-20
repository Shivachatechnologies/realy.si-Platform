import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { announcementInput, createAnnouncement, listAnnouncements, parseAnnouncementFilters } from "@/server/modules/comms/announcements";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listAnnouncements(ctx, orgId, companyId, parseAnnouncementFilters(Object.fromEntries(req.nextUrl.searchParams))));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/announcements", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createAnnouncement(ctx, orgId, companyId, await body(req, announcementInput)),
);
