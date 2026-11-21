import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { HeaderStrip } from "@/components/workforce/header-strip";
import { OrgDesigner, type SavedDesignWire } from "@/components/workforce/org-designer";
import { PageHeader } from "@/components/workforce/page-header";
import { PageState } from "@/components/workforce/states";
import { WorkforceTabs } from "@/components/workforce/workforce-tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatMoney, formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { getDesign, listDesigns } from "@/server/modules/workforce/org-designer";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("workforce.designer.title") };
}

/** Organization designer: size presets → departments, roles (each with its reason), budget and plan fit → provision. */
export default async function DesignerPage({ searchParams }: PageProps<"/[locale]/workforce/designer">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const tabs = <WorkforceTabs locale={locale} active="designer" labels={{ employees: t("workforce.tabs.employees"), org: t("workforce.tabs.org"), hire: t("workforce.tabs.hire"), usage: t("workforce.tabs.usage"), plans: t("workforce.tabs.plans"), tasks: t("workforce.tabs.tasks") }} />;
  const header = (
    <>
      <PageHeader eyebrow={t("modules.workforce.title")} title={t("workforce.designer.title")} subtitle={t("workforce.designer.subtitle")} />
      {tabs}
    </>
  );
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage, canRun] = await Promise.all([can(viewer.ctx, "agents.read", chain), can(viewer.ctx, "agents.manage", chain), can(viewer.ctx, "agents.run", chain)]);
  if (!canRead) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;
  const sp = await searchParams;
  const designId = typeof sp.design === "string" ? sp.design : null;
  const designs = await listDesigns(viewer.ctx, org.id, company.id);
  const selectedId = designId ?? designs.find((d) => d.status !== "APPLIED")?.id ?? null;
  const saved = selectedId
    ? await getDesign(viewer.ctx, org.id, company.id, selectedId).catch((err) => {
        if (isAppError(err) && err.code === "not_found") return null;
        throw err;
      })
    : null;
  const live = !!saved && (saved.refineStatus === "running" || saved.job?.status === "QUEUED" || saved.job?.status === "RUNNING");
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  return (
    <div className="mx-auto grid max-w-[1400px] gap-5">
      {header}
      <AutoRefresh active={live} intervalMs={4000} />
      <HeaderStrip t={t} what={t("workforce.designer.strip.what")} why={t("workforce.designer.strip.why")} can={t("workforce.designer.strip.can")} next={t("workforce.designer.strip.next")} />
      <OrgDesigner apiBase={apiBase} orgId={org.id} canManage={canManage} canRun={canRun && canManage} saved={saved ? (JSON.parse(JSON.stringify(saved)) as SavedDesignWire) : null} />
      {designs.length ? (
        <Card>
          <CardHeader title={t("workforce.designer.history")} />
          <ul className="divide-y">
            {designs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                <Link className="font-medium text-primary hover:underline" href={`/${locale}/workforce/designer?design=${d.id}`} aria-current={d.id === selectedId ? "true" : undefined}>
                  {d.name}
                </Link>
                <Badge tone={d.status === "APPLIED" ? "success" : d.status === "FAILED" ? "danger" : "neutral"}>{t(`workforce.designer.status.${d.status}`)}</Badge>
                <span className="text-muted-foreground">{t("workforce.designer.historyLine", { roles: formatNumber(d.total, locale), cost: formatMoney({ amountMinor: BigInt(d.monthlyCostCents), currency: "USD" }, locale) })}</span>
                <span className="ms-auto text-xs text-muted-foreground">{formatDate(d.createdAt, locale, "UTC")}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
