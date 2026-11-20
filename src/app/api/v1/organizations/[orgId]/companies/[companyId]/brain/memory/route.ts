import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createMemory, listMemories, memoryInput } from "@/server/modules/brain/memory";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listMemories(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/brain/memory", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createMemory(ctx, orgId, companyId, await body(req, memoryInput)),
);
