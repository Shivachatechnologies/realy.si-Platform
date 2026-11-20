import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getProgress, progressInput, saveProgress } from "@/server/modules/builder/journey";

/** The signed-in user's onboarding journey progress: stage, run and saved draft answers (resume where they left). */
export const GET = route({ auth: "required" }, async ({ ctx }) => ({ progress: await getProgress(ctx) }));

export const PATCH = route({ auth: "required", name: "PATCH /me/onboarding", rateLimits: LIMITS.tenantWrite, maxBodyBytes: 256 * 1024 }, async ({ req, ctx }) => saveProgress(ctx, await body(req, progressInput)));
