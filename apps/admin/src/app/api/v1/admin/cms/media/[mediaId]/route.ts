import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteMedia } from "@/server/modules/cms/media";

export const DELETE = route<{ mediaId: string }>({ auth: "required", name: "DELETE /admin/cms/media/:id", rateLimits: LIMITS.admin }, async ({ ctx }, { mediaId }) => deleteMedia(ctx, mediaId));
