import { route } from "@/server/core/http";
import { voiceBootstrap } from "@/server/modules/voiceos/service";

type P = { orgId: string; companyId: string };

/** GET — Voice OS bootstrap: the viewer's voice preferences, connected speech providers, AI readiness, minutes, live runs. */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => voiceBootstrap(ctx, orgId, companyId, req.nextUrl.searchParams.get("locale") ?? undefined));
