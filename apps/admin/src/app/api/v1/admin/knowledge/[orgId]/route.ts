import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { knowledgeAction, knowledgeActionInput } from "@/server/modules/admin/knowledge-admin";

/** Reindex, delete a document, set retention or purge one company's knowledge (platform.ai.manage, reason, audited). */
export const POST = route<{ orgId: string }>({ auth: "required", name: "POST /admin/knowledge/:orgId", rateLimits: LIMITS.admin }, async ({ req, ctx }, { orgId }) => knowledgeAction(ctx, orgId, await body(req, knowledgeActionInput)));
