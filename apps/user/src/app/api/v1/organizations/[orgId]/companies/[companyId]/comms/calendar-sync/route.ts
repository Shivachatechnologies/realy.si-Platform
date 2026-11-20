import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { authorize } from "@/server/modules/comms/common";
import { syncCompanyCalendar } from "@/server/modules/comms/calendar-sync";

type P = { orgId: string; companyId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/calendar-sync", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId }) => (await authorize(ctx, orgId, companyId, "communication.manage"), { synced: await syncCompanyCalendar(orgId, companyId) }),
);
