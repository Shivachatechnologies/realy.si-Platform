import { LIMITS } from "@/server/core/limits";
import { notFound } from "@/server/core/errors";
import { body, route } from "@/server/core/http";
import { emailTemplateAction, templateActionInput } from "@/server/modules/cms/email-templates";

/** publish | unpublish | test (sends the draft to `to` through the platform email provider). */
export const POST = route<{ key: string; locale: string; action: string }>(
  { auth: "required", name: "POST /admin/email-templates/:key/:locale/:action", rateLimits: LIMITS.admin, idempotent: true },
  async ({ req, ctx }, { key, locale, action }) => {
    if (action !== "publish" && action !== "unpublish" && action !== "test") throw notFound("Action");
    return emailTemplateAction(ctx, key, locale, action, await body(req, templateActionInput));
  },
);
