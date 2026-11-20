import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileSearch } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { MarketingShell, Pager, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { HelpPanel, InfoStrip } from "@/components/marketing/studio";
import { ResearchLauncher } from "@/components/marketing/research-launcher";
import { SmartEmpty } from "@/components/guide-kit/smart-empty";
import { getT } from "@/i18n/server";
import { formatDate, formatNumber } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { enumParam, pageParam, PAGE_SIZE } from "@/server/modules/marketing/common";
import { listHelpTasks } from "@/server/modules/marketing/intelligence";
import { listResearchReports, parseFindings, RESEARCH_KINDS, researchConnection } from "@/server/modules/marketing/research-reports";
import { getBrandKit } from "@/server/modules/marketing/brand";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.intelligence") };
}

export default async function MarketingIntelligencePage({ searchParams }: PageProps<"/[locale]/marketing/intelligence">) {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "intelligence" as const, title: t("marketing.intelligence.title"), subtitle: t("marketing.intelligence.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, tz, aiReady, canManage, canRunAgents } = m;
  const sp = await searchParams;
  const kind = enumParam(sp, "kind", RESEARCH_KINDS);
  const page = pageParam(sp);
  const [reports, provider, help, kit] = await Promise.all([
    listResearchReports(viewer.ctx, org.id, company.id, { kind, page }),
    researchConnection(org.id, company.id),
    listHelpTasks(org.id, company.id, "intelligence"),
    getBrandKit(viewer.ctx, org.id, company.id).catch(() => null),
  ]);
  const total = Object.values(reports.byKind).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <MarketingShell {...shell}>
      <InfoStrip t={t} k="intelligence" />
      {!provider ? (
        <Notice tone="warning">
          {t("marketing.intelligence.credentialRequired")}{" "}
          <Link href={`/${locale}/integrations`} className="font-medium underline">
            {t("marketing.common.openIntegrations")}
          </Link>
        </Notice>
      ) : null}
      {!aiReady ? <Notice tone="info">{t("marketing.intelligence.aiNotConfigured")}</Notice> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        {canManage ? (
          <Card className="p-4 sm:p-5">
            <h2 className="mb-1 font-display text-display">{t("marketing.intelligence.launcher.title")}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{provider ? t("marketing.intelligence.launcher.subtitle", { provider }) : t("marketing.intelligence.launcher.subtitleNoProvider")}</p>
            <ResearchLauncher base={base} locale={locale} connected={!!provider} defaultBrand={kit?.brandName ?? company.name} />
          </Card>
        ) : (
          <Notice tone="info">{t("marketing.intelligence.readOnly")}</Notice>
        )}
        <Card className="p-4 sm:p-5">
          <h2 className="mb-3 font-display text-display">{t("marketing.intelligence.atlas")}</h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {RESEARCH_KINDS.map((k) => {
              const n = reports.byKind[k] ?? 0;
              return (
                <li key={k}>
                  <Link
                    href={kind === k ? `/${locale}/marketing/intelligence` : `/${locale}/marketing/intelligence?kind=${k}`}
                    aria-current={kind === k ? "true" : undefined}
                    className={cn("grid gap-0.5 rounded-lg border p-3 transition hover:bg-muted", kind === k ? "border-primary bg-accent" : "bg-surface")}
                  >
                    <span className="text-xs text-muted-foreground">{t(`marketing.intelligence.kind.${k}`)}</span>
                    <span className="font-display text-display tabular-nums">{formatNumber(n, locale)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">{t("marketing.intelligence.atlasHint", { count: total })}</p>
        </Card>
      </div>

      <Card>
        <CardHeader title={kind ? t(`marketing.intelligence.kind.${kind}`) : t("marketing.intelligence.reports")} description={t("marketing.intelligence.reportsHint")} />
        {reports.data.length === 0 ? (
          <div className="p-4">
            <SmartEmpty icon={<FileSearch aria-hidden />} title={t("marketing.intelligence.emptyTitle")} body={t("marketing.intelligence.emptyBody")} />
          </div>
        ) : (
          <ul className="grid divide-y">
            {reports.data.map((r) => {
              const f = parseFindings(r.findings);
              return (
                <li key={r.id}>
                  <Link href={`/${locale}/marketing/intelligence/${r.id}`} className="group grid gap-1 px-4 py-3 hover:bg-muted/60 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                    <span className="text-[11px] font-semibold tracking-[0.06em] text-primary uppercase">{t(`marketing.intelligence.kind.${r.kind}`)}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.title}</span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {r.summary ?? (r.status === "CREDENTIAL_REQUIRED" ? t("marketing.intelligence.status.CREDENTIAL_REQUIRED") : r.error ?? t(`marketing.intelligence.statusHint.${r.status}`))}
                      </span>
                      {f?.insights.length ? <span className="text-[11px] text-muted-foreground">{t("marketing.intelligence.insightCount", { count: f.insights.length })}</span> : null}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <StatusBadge status={r.status} label={t(`marketing.intelligence.status.${r.status}`)} />
                      {formatDate(r.createdAt, locale, tz)}
                      <ArrowRight className="size-3.5 opacity-0 transition group-hover:opacity-100 rtl:-scale-x-100" aria-hidden />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <Pager path={`/${locale}/marketing/intelligence`} params={{ kind }} page={page} total={reports.total} pageSize={PAGE_SIZE} t={t} />
      </Card>
      <HelpPanel t={t} base={base} page="intelligence" tasks={help} locale={locale} tz={tz} aiReady={aiReady} canRun={canRunAgents} />
    </MarketingShell>
  );
}
