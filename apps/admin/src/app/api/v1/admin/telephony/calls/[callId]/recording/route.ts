import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { recordingInput, voiceCallRecording } from "@/server/modules/admin/telephony-admin";

/** Transcript and recording of a call (platform.security.manage, reason, audited). */
export const POST = route<{ callId: string }>({ auth: "required", name: "POST /admin/telephony/calls/:callId/recording", rateLimits: LIMITS.admin }, async ({ req, ctx }, { callId }) => voiceCallRecording(ctx, callId, await body(req, recordingInput)));
