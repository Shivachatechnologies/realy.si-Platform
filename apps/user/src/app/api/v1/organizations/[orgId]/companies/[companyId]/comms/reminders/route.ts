import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createReminder, listMyReminders, reminderInput } from "@/server/modules/comms/reminders";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listMyReminders(ctx, orgId, companyId) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/reminders", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createReminder(ctx, orgId, companyId, await body(req, reminderInput)),
);
