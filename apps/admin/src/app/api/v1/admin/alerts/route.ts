import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { requireAnyPlatform } from "@/server/modules/admin/access";
import { ALERT_READ, alertRulesCatalog, bulkAlertAction, bulkAlertInput, listAlerts } from "@/server/modules/admin/alerts";

/** GET: alerts (status, state, severity, rule, service, assignee, q, cursor) or `?view=rules`. POST: bulk ack/resolve. */
export const GET = route({ auth: "required", name: "GET /admin/alerts" }, async ({ req, ctx }) => {
  const { view, ...filters } = Object.fromEntries(req.nextUrl.searchParams);
  if (view === "rules") {
    await requireAnyPlatform(ctx, ALERT_READ);
    return alertRulesCatalog();
  }
  return listAlerts(ctx, filters);
});

export const POST = route({ auth: "required", name: "POST /admin/alerts", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }) => bulkAlertAction(ctx, await body(req, bulkAlertInput)));
