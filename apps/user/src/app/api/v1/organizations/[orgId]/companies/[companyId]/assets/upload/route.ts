import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { uploadAsset, uploadInput } from "@/server/modules/assets/service";

type P = { orgId: string; companyId: string };

/** POST { contentType, dataBase64, title?, scopeType?, scopeId? } — upload a PNG/JPEG/WebP (≤ 8 MB). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/assets/upload", rateLimits: LIMITS.tenantWrite, idempotent: true, maxBodyBytes: 12 * 1024 * 1024 },
  async ({ req, ctx }, { orgId, companyId }) => uploadAsset(ctx, orgId, companyId, await body(req, uploadInput)),
);
