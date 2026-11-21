import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { forget, forgetInput } from "@/server/modules/brain/memory-store";

type P = { orgId: string; companyId: string };

/** Data deletion: { kind: "memory" | "document" | "customer" | "employee" | "task", … }. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/brain/memory/forget", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => forget(ctx, orgId, companyId, await body(req, forgetInput)),
);
