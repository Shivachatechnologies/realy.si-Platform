import "server-only";
import { cache } from "react";
import { getLocale } from "@/i18n/server";
import { getWorkspaceContext, requireViewer } from "@/server/session";
import { listCompanies } from "@/server/modules/companies/service";

/** The viewer and their active organization/company (same choice as the top bar), once per request. */
export const activeScope = cache(async () => {
  const locale = await getLocale();
  const viewer = await requireViewer(locale);
  const { org, preferredCompanyId } = await getWorkspaceContext(viewer.user.id);
  if (!org) return { orgId: null, companyId: null, viewer };
  const companies = (await listCompanies(viewer.ctx, org.id, { limit: 200 })).data;
  const company = companies.find((c) => c.id === preferredCompanyId) ?? companies[0] ?? null;
  return { orgId: org.id as string | null, companyId: (company?.id ?? null) as string | null, viewer };
});
