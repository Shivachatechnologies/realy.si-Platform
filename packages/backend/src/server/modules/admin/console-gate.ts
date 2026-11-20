import { userContext } from "@/server/core/context";
import { isPlatformAdmin } from "@/server/core/platform-controls";
import { validateSessionToken, type SessionInfo } from "@/server/modules/auth/session";
import { can, mfaSatisfied } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";

export type ConsoleDenial = "unauthenticated" | "mfa_pending" | "forbidden" | "mfa_required" | "section_forbidden";
export type ConsoleAccess = { ok: true; session: SessionInfo } | { ok: false; reason: ConsoleDenial };

/**
 * Server-side gate for EVERY admin-app request (pages and API), run by apps/admin/src/proxy.ts before routing:
 *   1. a live admin-app session (its own cookie, @realy/auth-core),
 *   2. two-factor verification completed for that session,
 *   3. a platform-scoped role (PLATFORM / REGION / COUNTRY grant, the same check maintenance mode uses),
 *   4. a recent MFA verification (rbac MFA_FRESHNESS_MS; REALY_DEV_RELAX_MFA relaxes it in development only).
 * Route handlers still authorize each action with requirePlatform(ctx, permission) — this gate is the perimeter.
 */
export async function verifyConsoleAccess(token: string | undefined, pathname?: string): Promise<ConsoleAccess> {
  const session = await validateSessionToken(token);
  if (!session) return { ok: false, reason: "unauthenticated" };
  if (session.mfaPending) return { ok: false, reason: "mfa_pending" };
  if (!(await isPlatformAdmin(session.userId))) return { ok: false, reason: "forbidden" };
  if (!mfaSatisfied(userContext(session.userId, { sessionId: session.id, mfaVerifiedAt: session.mfaVerifiedAt }))) return { ok: false, reason: "mfa_required" };
  const needed = pathname ? sectionPermissions(pathname) : null;
  if (needed) {
    const ctx = userContext(session.userId, { sessionId: session.id, mfaVerifiedAt: session.mfaVerifiedAt });
    const allowed = await Promise.all(needed.map((p) => can(ctx, p, platformChain())));
    if (!allowed.some(Boolean)) return { ok: false, reason: "section_forbidden" };
  }
  return { ok: true, session };
}

const AUDIT = ["platform.audit.read", "platform.security.read"];
const CONTENT = ["platform.content.manage"];
const PRICING = ["pricing.read", "platform.subscriptions.read", "globalization.read"];
const OPS = ["platform.controls.manage", "platform.security.read", "platform.audit.read"];
const PEOPLE = ["platform.users.read", "platform.organizations.read", "platform.support.read"];

/**
 * Admin RBAC per Control Center section: the platform permissions of which ANY grants access to a page section
 * (`/<locale>/<section>…`) or admin API (`/api/v1/admin/<section>…`). Super/Platform/Support/Finance/Content/
 * AI Operations/Security/Read-only admins each reach only the sections their permissions cover; every route
 * handler still checks the exact permission of its action. Unlisted sections (overview, search) need only a
 * platform role.
 */
const SECTIONS: Record<string, string[]> = {
  users: ["platform.users.read", "platform.support.read"],
  organizations: ["platform.organizations.read", "platform.support.read"],
  ai: ["platform.ai.read", "platform.ai.manage"],
  pricing: PRICING,
  plans: PRICING,
  prices: PRICING,
  promotions: PRICING,
  subscriptions: PRICING,
  revenue: PRICING,
  countries: ["globalization.read", "pricing.read"],
  regions: ["globalization.read", "pricing.read"],
  controls: ["platform.controls.manage", "platform.audit.read", "platform.ai.read"],
  settings: ["platform.controls.manage", "platform.audit.read"],
  system: OPS,
  jobs: OPS,
  ops: [...OPS, "platform.subscriptions.read"],
  announcements: ["platform.controls.manage", "platform.content.manage", "platform.audit.read"],
  banner: ["platform.controls.manage"],
  flags: ["flags.read", "flags.manage"],
  "feature-flags": ["flags.read", "flags.manage"],
  "feature-flag-rules": ["flags.read", "flags.manage"],
  integrations: ["platform.security.read", "platform.organizations.read", "platform.controls.manage"],
  developers: ["platform.security.read", "platform.organizations.read", "platform.controls.manage"],
  "api-keys": ["platform.security.read", "platform.security.manage"],
  webhooks: ["platform.security.read", "platform.security.manage"],
  audit: AUDIT,
  "audit-logs": AUDIT,
  security: AUDIT,
  sessions: AUDIT,
  roles: ["platform.security.read", "platform.security.manage", "platform.users.read"],
  cms: CONTENT,
  "email-templates": CONTENT,
  marketplace: CONTENT,
  notes: PEOPLE,
};

export function sectionPermissions(pathname: string): string[] | null {
  const parts = pathname.split("/").filter(Boolean);
  const section = parts[0] === "api" ? (parts[2] === "admin" ? parts[3] : undefined) : parts[1];
  return section ? (SECTIONS[section] ?? null) : null;
}
