import { body, route } from "@/server/core/http";
import { createOrganization, createOrganizationInput, listMyOrganizations } from "@/server/modules/organizations/service";

export const GET = route({ auth: "required" }, async ({ ctx }) => ({ data: await listMyOrganizations(ctx) }));
export const POST = route({ auth: "required" }, async ({ req, ctx }) => createOrganization(ctx, await body(req, createOrganizationInput)));
