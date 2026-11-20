import type { Metadata } from "next";
import { Marketplace, type MarketplaceItem } from "@/components/integrations/marketplace";
import { integrationTabLabels, IntegrationsTabs } from "@/components/integrations/tabs";
import { Forbidden, NoCompany, Stat } from "@/components/automation/page-frame";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { integrationsHealth, listIntegrations, usageSummary } from "@/server/modules/integrations/service";
import { formatCostMicros } from "@/components/integrations/usage-format";
import { formatNumber } from "@/i18n/format";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";
import { Section } from "@/components/ui/scene";
import { PageHeader } from "@/components/ui/page-header";
import { ProviderConstellation } from "@/components/graphics/provider-constellation";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.integrations.title") };
}

export default async function IntegrationsPage({ searchParams }: PageProps<"/[locale]/integrations">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const frame = (children: React.ReactNode) => (
    <div className="mx-auto grid max-w-[1400px] gap-6">
      <PageHeader variant="editorial" world="integrations" eyebrow={t("dna.worlds.integrations")} title={t("modules.integrations.title")} description={t("integrations.subtitle")} />
      {children}
    </div>
  );
  if (!company) return frame(<NoCompany message={t("company.empty")} />);
  const chain = await companyChain(db(), org.id, company.id);
  if (!(await can(viewer.ctx, "integrations.read", chain))) return frame(<Forbidden message={t("errors.forbidden")} />);
  const view = (await searchParams).view === "connected" ? "connected" : "all";
  const list = await listIntegrations(viewer.ctx, org.id, company.id);
  const [{ syncErrors, failedDeliveries }, usage] = await Promise.all([integrationsHealth(viewer.ctx, org.id, company.id), usageSummary(viewer.ctx, org.id, company.id, { days: 30 })]);
  const items: MarketplaceItem[] = list.map((i) => ({
    key: i.info.key,
    name: i.info.name,
    category: i.info.category,
    authType: i.info.authType,
    status: i.status === "CONNECTED" || i.status === "ERROR" ? i.status : null,
    account: i.connection?.status !== "DISCONNECTED" ? (i.connection?.externalAccount ?? null) : null,
    configured: i.configured || i.oauthAvailable,
  }));
  const connected = items.filter((i) => i.status).length;
  const failing = items.filter((i) => i.status === "ERROR").length;
  return frame(
    <>
      <IntegrationsTabs
        locale={locale}
        active={view === "connected" ? "connected" : "marketplace"}
        labels={integrationTabLabels(t)}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Stat label={t("integrations.metrics.connected")} value={connected} hint={t("integrations.ofAvailable", { count: items.length })} />
        <Stat label={t("integrations.failing")} value={failing} />
        <Stat label={t("integrations.metrics.syncErrors")} value={syncErrors} hint={t("integrations.last30Days")} />
        <Stat label={t("integrations.metrics.webhookFailures")} value={failedDeliveries} hint={t("integrations.last30Days")} />
        <Stat label={t("integrations.usage.calls")} value={formatNumber(usage.totals.calls, locale)} hint={t("integrations.usage.failedHint", { count: usage.totals.failed })} />
        <Stat label={t("integrations.usage.estimatedCost")} value={formatCostMicros(usage.totals.costMicros, locale)} hint={t("integrations.last30Days")} />
      </div>
      <Section eyebrow={t("dna.integrations.eyebrow")} title={t("dna.integrations.title")} description={t("dna.integrations.description", { connected, total: items.length })}>
        <div className="overflow-hidden rounded-3xl border bg-[radial-gradient(ellipse_at_center,var(--world-soft),var(--surface)_75%)] p-3">
          <ProviderConstellation
            companyName={company.name}
            providers={items.map((i) => ({ key: i.key, name: i.name, category: i.category, categoryLabel: t(`integrations.categories.${i.category}`), status: i.status, href: `/${locale}/integrations/${i.key}` }))}
          />
        </div>
      </Section>
      <Marketplace key={view} locale={locale} items={items} initialView={view} />
    </>,
  );
}
