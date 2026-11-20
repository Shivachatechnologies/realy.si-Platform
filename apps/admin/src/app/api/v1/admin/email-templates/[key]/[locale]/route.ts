import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getEmailTemplate, saveEmailTemplate, templateInput } from "@/server/modules/cms/email-templates";

type P = { key: string; locale: string };

export const GET = route<P>({ auth: "required", name: "GET /admin/email-templates/:key/:locale" }, async ({ ctx }, { key, locale }) => getEmailTemplate(ctx, key, locale));

export const PUT = route<P>({ auth: "required", name: "PUT /admin/email-templates/:key/:locale", rateLimits: LIMITS.admin, maxBodyBytes: 128 * 1024 }, async ({ req, ctx }, { key, locale }) =>
  saveEmailTemplate(ctx, key, locale, await body(req, templateInput)),
);
