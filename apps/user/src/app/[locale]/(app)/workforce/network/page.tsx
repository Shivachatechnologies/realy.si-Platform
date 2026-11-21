import type { Metadata } from "next";
import { LiveNetworkView, type LiveGraphWire } from "@/components/workforce/live-network-view";
import { HeaderStrip } from "@/components/workforce/header-strip";
import { PageHeader } from "@/components/workforce/page-header";
import { PageState } from "@/components/workforce/states";
import { WorkforceTabs } from "@/components/workforce/workforce-tabs";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { liveGraph } from "@/server/modules/workforce/live-network";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("workforce.network.title") };
}

/** Live company network: the real hierarchy (AI CEO at the centre, executives, managers, specialists, humans) with live signals. */
export default async function NetworkPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const tabs = <WorkforceTabs locale={locale} active="network" labels={{ employees: t("workforce.tabs.employees"), org: t("workforce.tabs.org"), hire: t("workforce.tabs.hire"), usage: t("workforce.tabs.usage"), plans: t("workforce.tabs.plans"), tasks: t("workforce.tabs.tasks") }} />;
  const header = (
    <>
      <PageHeader eyebrow={t("modules.workforce.title")} title={t("workforce.network.title")} subtitle={t("workforce.network.subtitle")} illustration={false} />
      {tabs}
    </>
  );
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  if (!(await can(viewer.ctx, "agents.read", chain))) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;
  const graph = await liveGraph(viewer.ctx, org.id, company.id);
  return (
    <div className="mx-auto grid max-w-[1400px] gap-5">
      {header}
      <HeaderStrip t={t} what={t("workforce.network.strip.what")} why={t("workforce.network.strip.why")} can={t("workforce.network.strip.can")} next={t("workforce.network.strip.next")} />
      <LiveNetworkView apiBase={`/api/v1/organizations/${org.id}/companies/${company.id}`} initial={graph as LiveGraphWire} />
    </div>
  );
}
