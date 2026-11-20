import "server-only";
import type { ReactNode } from "react";
import { IntegrationsTabs, type IntegrationsTab } from "@/components/integrations/tabs";
import { Forbidden, NoCompany, PageFrame } from "@/components/automation/page-frame";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

/**
 * Loads the shared context of an Integrations page. Returns either a ready page (no company / forbidden) or the
 * context plus a `render` that wraps content in the header and tabs.
 */
export async function integrationsPage(tab: IntegrationsTab, opts: { title?: string; actions?: ReactNode } = {}) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const wrap = (children: ReactNode, withTabs = true) => (
    <PageFrame title={opts.title ?? t("modules.integrations.title")} subtitle={opts.title ? undefined : t("integrations.subtitle")} actions={opts.actions}>
      {withTabs ? (
        <IntegrationsTabs
          locale={locale}
          active={tab}
          labels={{ marketplace: t("integrations.tabs.marketplace"), connected: t("integrations.tabs.connected"), webhooks: t("integrations.tabs.webhooks"), syncs: t("integrations.tabs.syncs") }}
        />
      ) : null}
      {children}
    </PageFrame>
  );
  if (!company) return { page: wrap(<NoCompany message={t("company.empty")} />, false) } as const;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "integrations.read", chain), can(viewer.ctx, "integrations.manage", chain)]);
  if (!canRead) return { page: wrap(<Forbidden message={t("errors.forbidden")} />, false) } as const;
  return {
    page: null,
    ctx: { locale, t, viewer, org, company, canManage, tz: company.timezone ?? "UTC", base: `/api/v1/organizations/${org.id}/companies/${company.id}` },
    render: wrap,
  } as const;
}
