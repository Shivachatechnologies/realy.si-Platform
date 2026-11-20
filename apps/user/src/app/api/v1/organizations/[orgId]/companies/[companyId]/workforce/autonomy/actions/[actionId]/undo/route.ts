import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { undoAutonomousAction } from "@/server/modules/workforce/autonomy-service";

type P = { orgId: string; companyId: string; actionId: string };

/** Undo a reversible auto-approved action (runs its recorded reversal as the signed-in person). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workforce/autonomy/actions/:actionId/undo", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, actionId }) => undoAutonomousAction(ctx, orgId, companyId, actionId),
);
