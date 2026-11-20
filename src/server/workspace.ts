import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "@/server/core/db";
import { forbidden } from "@/server/core/errors";
import { orgAccessViolations } from "@/server/modules/enterprise/policy";
import { listCompanies } from "@/server/modules/companies/service";
import { loadGrants } from "@/server/modules/rbac/service";
import { isPlatformScope } from "@/server/modules/rbac/scope";
import { getWorkspaceContext, requireViewer } from "@/server/session";
import type { AppLocale } from "@/i18n/config";

/** Viewer + active organization + visible companies + active company. Redirects to onboarding when there is no organization. */
export const requireOrgContext = cache(async (locale: AppLocale) => {
  const viewer = await requireViewer(locale);
  const { orgs, org, preferredCompanyId } = await getWorkspaceContext(viewer.user.id);
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
