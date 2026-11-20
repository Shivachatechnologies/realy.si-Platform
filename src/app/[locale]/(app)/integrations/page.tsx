import type { Metadata } from "next";
import { Marketplace, type MarketplaceItem } from "@/components/integrations/marketplace";
import { IntegrationsTabs } from "@/components/integrations/tabs";
import { Forbidden, NoCompany, PageFrame, Stat } from "@/components/automation/page-frame";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { integrationsHealth, listIntegrations } from "@/server/modules/integrations/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.integrations.title") };
}

export default async function IntegrationsPage({ searchParams }: PageProps<"/[locale]/integrations">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const frame = (children: React.ReactNode) => (
    <PageFrame title={t("modules.integrations.title")} subtitle={t("integrations.subtitle")}>
      {children}
    </PageFrame>
  );
  if (!company) return frame(<NoCompany message={t("company.empty")} />);
  const chain = await companyChain(db(), org.id, company.id);
  if (!(await can(viewer.ctx, "integrations.read", chain))) return frame(<Forbidden message={t("errors.forbidden")} />);
  const view = (await searchParams).view === "connected" ? "connected" : "all";
  const list = await listIntegrations(viewer.ctx, org.id, company.id);
  const { syncErrors, failedDeliveries } = await integrationsHealth(viewer.ctx, org.id, company.id);
  const items: MarketplaceItem[] = list.map((i) => ({
    key: i.info.key,
    name: i.info.name,
    category: i.info.category,
    authType: i.info.authType,
    status: i.status === "CONNECTED" || i.status === "ERROR" ? i.status : null,
    account: i.connection?.status !== "DISCONNECTED" ? (i.connection?.externalAccount ?? null) : null,
    configured: i.configured,
  }));
  const connected = items.filter((i) => i.status).length;
  const failing = items.filter((i) => i.status === "ERROR").length;
  return frame(
    <>
      <IntegrationsTabs
        locale={locale}
        active={view === "connected" ? "connected" : "marketplace"}
        labels={{ marketplace: t("integrations.tabs.marketplace"), connected: t("integrations.tabs.connected"), webhooks: t("integrations.tabs.webhooks"), syncs: t("integrations.tabs.syncs") }}
      />
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={t("integrations.metrics.connected")} value={connected} hint={t("integrations.ofAvailable", { count: items.length })} />
        <Stat label={t("integrations.failing")} value={failing} />
        <Stat label={t("integrations.metrics.syncErrors")} value={syncErrors} hint={t("integrations.last30Days")} />
        <Stat label={t("integrations.metrics.webhookFailures")} value={failedDeliveries} hint={t("integrations.last30Days")} />
      </div>
      <Marketplace key={view} locale={locale} items={items} initialView={view} />
    </>,
  );
}
