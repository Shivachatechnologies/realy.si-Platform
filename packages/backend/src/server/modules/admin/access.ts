import { z } from "zod";
import type { RequestContext } from "@/server/core/context";
import { forbidden, invalid } from "@/server/core/errors";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";

/** Every sensitive admin change carries a reason that lands in the audit log. */
export const reasonSchema = z.string().trim().min(3).max(500);

export const isUuid = (v: string) => z.string().uuid().safeParse(v).success;

export const requirePlatform = (ctx: RequestContext, permission: string) => requirePermission(ctx, permission, platformChain());

/** Authorize with any one of several platform permissions. */
export async function requireAnyPlatform(ctx: RequestContext, permissions: string[]) {
  for (const p of permissions) if (await can(ctx, p, platformChain())) return requirePermission(ctx, p, platformChain());
  throw forbidden(`Missing permission ${permissions.join(" or ")}`, { permission: permissions[0] });
}

/** UI capability hint (never enforcement). */
export const canPlatform = (ctx: RequestContext, permission: string) => can(ctx, permission, platformChain());

/** Permissions the admin UI needs to decide what to show, resolved once. */
export async function adminCapabilities(ctx: RequestContext) {
  const keys = [
    "platform.users.read",
    "platform.users.manage",
    "platform.organizations.read",
    "platform.organizations.manage",
    "platform.subscriptions.read",
    "platform.security.read",
    "platform.security.manage",
    "platform.audit.read",
    "platform.controls.manage",
    "platform.ai.read",
    "platform.ai.manage",
    "pricing.read",
    "pricing.manage",
    "flags.read",
    "flags.manage",
    "platform.content.manage",
    "platform.support.read",
    "platform.subscriptions.manage",
  ] as const;
  const values = await Promise.all(keys.map((k) => can(ctx, k, platformChain())));
  return Object.fromEntries(keys.map((k, i) => [k, values[i]!])) as Record<(typeof keys)[number], boolean>;
}

/** Typed confirmation for critical actions: the admin must type the exact phrase shown in the dialog. */
export function requireConfirmation(given: string | undefined, expected: string) {
  if ((given ?? "").trim() !== expected) throw invalid("Type the confirmation phrase exactly to continue", { reason: "confirmation_mismatch" });
}

/** Start of the UTC day / month, n days ago. */
export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
export const utcMonthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};
export const utcDayStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
