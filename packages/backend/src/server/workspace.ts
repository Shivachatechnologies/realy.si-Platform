import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/server/core/db";
import { getControls, isModuleEnabled, isOrganizationSuspended, isPlatformAdmin, moduleForPagePath } from "@/server/core/platform-controls";
import { forbidden } from "@/server/core/errors";
import { orgAccessViolations } from "@/server/modules/enterprise/policy";
import { listCompanies } from "@/server/modules/companies/service";
import { loadGrants } from "@/server/modules/rbac/service";
import { isPlatformScope } from "@/server/modules/rbac/scope";
import { ORG_COOKIE, getWorkspaceContext, requireViewer } from "@/server/session";
import type { AppLocale } from "@/i18n/config";

/** Viewer + active organization + visible companies + active company. Redirects to onboarding when there is no organization. */
export const requireOrgContext = cache(async (locale: AppLocale) => {
  const viewer = await requireViewer(locale);
  const { orgs, org, preferredCompanyId } = await getWorkspaceContext(viewer.user.id);
  await platformPageGate(locale, viewer.user.id, org?.id ?? null);
  if (!org) redirect(`/${locale}/onboarding`);
  // Organization security policy for pages: an expired session (org timeout) signs in again; a blocked network address
  // is refused. Require-MFA is enforced on the API and shown as a banner so members can still reach MFA setup.
  const violations = await orgAccessViolations(viewer.ctx, org.id);
  if (violations.includes("session_expired")) redirect(`/${locale}/sign-in`);
  if (violations.includes("ip_blocked")) throw forbidden("Your network address is not on the organization's allowlist", { reason: "enterprise_ip_blocked" });
  const companies = (await listCompanies(viewer.ctx, org.id, { limit: 200 })).data;
  const company = companies.find((c) => c.id === preferredCompanyId) ?? companies[0] ?? null;
  return { viewer, orgs, org, companies, company };
});

/** Platform grants (PLATFORM / REGION / COUNTRY scopes) of the viewer — for showing the Admin Console entry. */
export const platformGrants = cache(async (userId: string) => {
  const grants = await loadGrants(db(), "USER", userId);
  return grants.filter((g) => isPlatformScope(g.scopeType));
});

/**
 * Platform controls for app pages (Admin → Platform Controls), applied by requireOrgContext so module pages cannot
 * skip it: maintenance mode (platform admins pass), a suspended organization, and modules disabled for the
 * organization. Each case shows /unavailable with the reason.
 */
async function platformPageGate(locale: AppLocale, userId: string, orgId: string | null) {
  const unavailable = (reason: string, module?: string) =>
    redirect(`/${locale}/unavailable?${new URLSearchParams({ reason, ...(module ? { module } : {}) })}`);
  const controls = await getControls();
  if (controls.maintenanceMode && !(await isPlatformAdmin(userId))) unavailable("maintenance");
  // Suspended organizations are hidden from the switcher; a member who selected (or only has) one is told why.
  const wanted = (await cookies()).get(ORG_COOKIE)?.value;
  const suspendedId =
    wanted && wanted !== orgId && /^[0-9a-f-]{36}$/.test(wanted) && (await isOrganizationSuspended(wanted)) && (await db().membership.count({ where: { organizationId: wanted, userId, status: "ACTIVE" } }))
      ? wanted
      : !orgId
        ? (await db().membership.findFirst({ where: { userId, status: "ACTIVE", organization: { status: "SUSPENDED" } }, select: { organizationId: true } }))?.organizationId
        : null;
  if (suspendedId) unavailable("organization_suspended");
  const path = (await headers()).get("x-realy-path") ?? "";
  const mod = moduleForPagePath(path);
  if (mod && !(await isModuleEnabled(orgId, mod))) unavailable("module_disabled", mod);
}
