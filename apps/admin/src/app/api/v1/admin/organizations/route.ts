import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adminCreateOrganization, createOrgInput } from "@/server/modules/admin/people";

/** Create an organization for an existing user (who becomes its owner). */
export const POST = route({ auth: "required", name: "POST /admin/organizations", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }) => adminCreateOrganization(ctx, await body(req, createOrgInput)));
