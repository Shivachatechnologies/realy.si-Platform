import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Kpi, MarketingShell, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { AppError } from "@/server/core/errors";
import { getAudit } from "@/server/modules/marketing/seo";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.seo.audit") };
}

const SEVERITY = { error: "FAILED", warning: "PAUSED", info: "DRAFT" } as const;

export default async function SeoAuditPage({ params }: PageProps<"/[locale]/marketing/seo/[projectId]/audits/[auditId]">) {
  const { projectId, auditId } = await params;
  const m = await loadMarketing();
  const { locale, t } = m;
  const back = { href: `/${locale}/marketing/seo/${projectId}`, label: t("marketing.seo.title") };
  if (m.blocked) return <MarketingShell locale={locale} t={t} tab="seo" title={t("marketing.seo.audit")} back={back} blocked={m.blocked} />;
  const { org, company, viewer, tz } = m;
  const a = await getAudit(viewer.ctx, org.id, company.id, auditId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  if (a.projectId !== projectId) notFound();
  const issues = (a.issues ?? []) as { code: string; severity: "error" | "warning" | "info"; value?: string | number }[];
  const facts: [string, string | number | null][] = [
    [t("marketing.seo.pageTitle"), a.title ? `${a.title} (${a.title.length})` : null],
    [t("marketing.seo.metaDescription"), a.metaDescription ? `${a.metaDescription} (${a.metaDescription.length})` : null],
    [t("marketing.seo.h1Count"), a.h1Count],
    [t("marketing.seo.canonical"), a.canonical],
    [t("marketing.seo.robots"), a.robots],
    [t("marketing.seo.images"), a.imageCount != null ? `${a.imagesWithAlt ?? 0} / ${a.imageCount}` : null],
    [t("marketing.seo.wordCount"), a.wordCount],
    [t("marketing.seo.links"), a.internalLinks != null ? t("marketing.seo.linksValue", { internal: a.internalLinks, external: a.externalLinks ?? 0 }) : null],
    [t("marketing.seo.httpStatus"), a.httpStatus],
  ];
  return (
    <MarketingShell locale={locale} t={t} tab="seo" back={{ href: back.href, label: a.project.name }} title={t("marketing.seo.audit")} subtitle={`${a.url} · ${formatDateTime(a.createdAt, locale, tz)}`}>
      {a.status === "FAILED" ? (
        <Notice tone="danger">{t(`marketing.seo.auditErrors.${a.error ?? "fetch_failed"}`)}</Notice>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Kpi label={t("marketing.seo.score")} value={a.score ?? "—"} tone={(a.score ?? 0) >= 80 ? "success" : (a.score ?? 0) < 50 ? "danger" : undefined} />
            <Kpi label={t("marketing.seo.errors")} value={issues.filter((i) => i.severity === "error").length} />
            <Kpi label={t("marketing.seo.warnings")} value={issues.filter((i) => i.severity === "warning").length} />
            <Kpi label={t("marketing.seo.wordCount")} value={a.wordCount ?? "—"} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={t("marketing.seo.issues")} />
              {issues.length === 0 ? (
                <p className="p-4 text-sm text-success">{t("marketing.seo.noIssues")}</p>
              ) : (
                <ul className="grid divide-y">
                  {issues.map((i, n) => (
                    <li key={`${i.code}-${n}`} className="flex items-start gap-2 px-4 py-2 text-sm">
                      <StatusBadge status={SEVERITY[i.severity]} label={t(`marketing.seo.severity.${i.severity}`)} />
                      <span>{t(`marketing.seo.issue.${i.code}`, { value: i.value ?? "" })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title={t("marketing.seo.onPage")} />
              <dl className="grid gap-2 p-4 text-sm">
                {facts.map(([k, v]) => (
                  <div key={k} className="grid gap-0.5 sm:grid-cols-[10rem_minmax(0,1fr)]">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="break-words">{v ?? "—"}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>
        </>
      )}
    </MarketingShell>
  );
}
