import type { NextRequest } from "next/server";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { configCreateSchema, configKind, createConfig, listConfig } from "@/server/modules/crm/config";

type P = { orgId: string; companyId: string; kind: string };

/** Settings collections: sources, custom-fields, segments, assignment-rules, stage-rules, targets, commission-rules. */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, kind }) => ({ data: await listConfig(ctx, orgId, companyId, configKind(kind)) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/settings/:kind", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, kind }) => {
  const k = configKind(kind);
  return createConfig(ctx, orgId, companyId, k, await body(req as NextRequest, configCreateSchema(k)));
});
