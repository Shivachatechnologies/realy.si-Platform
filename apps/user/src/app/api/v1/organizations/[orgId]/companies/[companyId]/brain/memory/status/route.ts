import { route } from "@/server/core/http";
import { memoryStatus } from "@/server/modules/brain/memory-store";

type P = { orgId: string; companyId: string };

/** Retrieval status: "fts" (full-text only) or "hybrid", the reason, the provider and embedding coverage. */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => memoryStatus(ctx, orgId, companyId));
