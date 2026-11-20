import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteReminder } from "@/server/modules/comms/reminders";

type P = { orgId: string; companyId: string; reminderId: string };
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/comms/reminders/:reminderId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, reminderId }) => deleteReminder(ctx, orgId, companyId, reminderId),
);
