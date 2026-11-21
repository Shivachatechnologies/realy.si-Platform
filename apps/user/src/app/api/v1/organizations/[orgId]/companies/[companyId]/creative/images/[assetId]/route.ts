import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { z } from "zod";
import { editStudioImage, regenerateImage, upscaleStudioImage } from "@/server/modules/creative/images";

type P = { orgId: string; companyId: string; assetId: string };
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("regenerate"), prompt: z.string().trim().min(3).max(3000).optional() }),
  z.object({ action: z.literal("edit"), instruction: z.string().trim().min(3).max(2000) }),
  z.object({ action: z.literal("upscale") }),
]);
/** POST { action: regenerate | edit | upscale } — creates a new version of the image. */
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/creative/images/:assetId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, assetId }) => {
  const b = await body(req, input);
  if (b.action === "edit") return editStudioImage(ctx, orgId, companyId, assetId, { instruction: b.instruction });
  if (b.action === "upscale") return upscaleStudioImage(ctx, orgId, companyId, assetId);
  return regenerateImage(ctx, orgId, companyId, assetId, { prompt: b.prompt });
});
