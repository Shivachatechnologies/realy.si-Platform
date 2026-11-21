import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { listMedia, MEDIA_MAX_BYTES, uploadMedia, uploadMediaInput } from "@/server/modules/cms/media";

export const GET = route({ auth: "required", name: "GET /admin/cms/media" }, async ({ ctx }) => listMedia(ctx));

/** Upload an image (JSON with base64 data) through the integrations storage service. */
export const POST = route(
  { auth: "required", name: "POST /admin/cms/media", rateLimits: LIMITS.admin, idempotent: true, maxBodyBytes: Math.ceil((MEDIA_MAX_BYTES * 4) / 3) + 64 * 1024 },
  async ({ req, ctx }) => uploadMedia(ctx, await body(req, uploadMediaInput)),
);
