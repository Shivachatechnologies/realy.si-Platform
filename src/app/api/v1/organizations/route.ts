import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createOrganization, createOrganizationInput, listMyOrganizations } from "@/server/modules/organizations/service";

export const GET = route({ auth: "required" }, async ({ ctx }) => ({ data: await listMyOrganizations(ctx) }));
export const POST = route({ auth: "required", name: "POST /organizations", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }) => createOrganization(ctx, await body(req, createOrganizationInput)));
