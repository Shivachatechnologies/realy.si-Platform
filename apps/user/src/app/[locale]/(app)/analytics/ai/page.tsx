import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { TaskStatusBadge } from "@/components/agents/status-badge";
import { AnalyticsHeader } from "@/components/bi/shell";
import { BriefingForm } from "@/components/workforce/briefing-form";
import { PageState, qs } from "@/components/workforce/states";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { listBriefings } from "@/server/modules/workforce/briefings";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("analytics.ai.title") };
}

const MODES = ["WEEKLY", "MONTHLY", "TREND_RISK"] as const;

export default async function AnalyticsAiPage({ searchParams }: PageProps<"/[locale]/analytics/ai">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = <AnalyticsHeader t={t} locale={locale} active="ai" title={t("analytics.ai.title")} subtitle={t("analytics.ai.subtitle")} />;
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canAgents, canRun] = await Promise.all([can(viewer.ctx, "analytics.read", chain), can(viewer.ctx, "agents.read", chain), can(viewer.ctx, "agents.run", chain)]);
  if (!canRead || !canAgents) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;
  const { briefing } = await searchParams;
  const history = await listBriefings(viewer.ctx, org.id, company.id, { profile: "bi_analyst", limit: 20 });
  const selected = history.data.find((b) => b.id === briefing) ?? history.data[0] ?? null;
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const configured = aiConfigured();

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      <AutoRefresh active={history.data.some((b) => b.task && (b.task.status === "QUEUED" || b.task.status === "RUNNING"))} intervalMs={5000} />
      {header}
      {!configured ? <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice> : null}
      {canRun && configured ? (
        <Card>
          <CardHeader title={t("analytics.ai.generate")} description={t("analytics.ai.generateHint")} />
          <CardBody>
            <BriefingForm apiBase={apiBase} modes={MODES} profile="bi_analyst" />
          </CardBody>
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title={selected ? `${t(`intelligence.modes.${selected.mode}`)} · ${formatDateTime(selected.createdAt, locale, viewer.user.timezone)}` : t("analytics.ai.latest")}
            actions={
              selected?.task ? (
                <span className="flex items-center gap-2">
                  <TaskStatusBadge status={selected.task.status} label={t(`agentTasks.status.${selected.task.status}`)} />
                  <Link className="text-xs text-primary hover:underline" href={`/${locale}/tasks/${selected.task.id}`}>
                    {t("intelligence.openTask")}
                  </Link>
                </span>
              ) : null
            }
          />
          <CardBody>
            {!selected ? (
              <p className="text-sm text-muted-foreground">{t("analytics.ai.empty")}</p>
            ) : selected.task?.output ? (
              <div className="grid gap-2">
                <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{selected.task.output}</div>
                <p className="text-xs text-muted-foreground">{t("agentTasks.reviewNote")}</p>
              </div>
            ) : selected.task?.status === "FAILED" ? (
              <Notice tone="danger">{t("agentTasks.failed", { message: selected.task.errorMessage ?? "" })}</Notice>
            ) : (
              <p className="text-sm text-muted-foreground">{t("intelligence.writing")}</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("intelligence.history")} />
          {history.data.length === 0 ? (
            <CardBody className="text-sm text-muted-foreground">{t("analytics.ai.empty")}</CardBody>
          ) : (
            <ul className="divide-y">
              {history.data.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <Link href={`/${locale}/analytics/ai${qs({ briefing: b.id })}`} className={selected?.id === b.id ? "font-semibold hover:underline" : "hover:underline"}>
                    {t(`intelligence.modes.${b.mode}`)}
                    <span className="ms-2 text-xs font-normal text-muted-foreground">{formatDateTime(b.createdAt, locale, viewer.user.timezone)}</span>
                  </Link>
                  {b.task ? <TaskStatusBadge status={b.task.status} label={t(`agentTasks.status.${b.task.status}`)} /> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
