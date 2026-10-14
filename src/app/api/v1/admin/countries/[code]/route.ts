import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { updateCountry, updateCountryInput } from "@/server/modules/globalization/service";

export const PATCH = route<{ code: string }>({ auth: "required", name: "PATCH /admin/countries/:code", rateLimits: LIMITS.admin }, async ({ req, ctx }, { code }) => updateCountry(ctx, code.toUpperCase(), await body(req, updateCountryInput)));
