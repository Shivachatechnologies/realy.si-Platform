import type { Metadata } from "next";
import { InfoStrip } from "@/components/marketing/studio";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { ProjectForm } from "@/components/marketing/seo-forms";
import { MarketingShell, loadMarketing } from "@/components/marketing/shell";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { listProjects } from "@/server/modules/marketing/seo";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.seo") };
}

export default async function SeoPage() {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "seo" as const, title: t("marketing.seo.title"), subtitle: t("marketing.seo.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage, tz } = m;
  const projects = await listProjects(viewer.ctx, org.id, company.id);
  return (
    <MarketingShell {...shell}>
      <InfoStrip t={t} k="seo" />
      {canManage ? (
        <Card>
          <CardHeader title={t("marketing.seo.createProject")} />
          <ProjectForm base={base} locale={locale} />
        </Card>
      ) : null}
      {projects.length === 0 ? (
        <Card>
          <p className="p-4 text-muted-foreground">{t("marketing.seo.empty")}</p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/${locale}/marketing/seo/${p.id}`} className="rounded-lg border bg-surface p-4 hover:bg-muted">
              <p className="font-medium">{p.name}</p>
              <p className="text-xs text-muted-foreground">{p.domain}</p>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">{t("marketing.seo.keywords")}</dt>
                  <dd className="tabular-nums">{p._count.keywords}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("marketing.seo.competitors")}</dt>
                  <dd className="tabular-nums">{p._count.competitors}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("marketing.seo.lastScore")}</dt>
                  <dd className="tabular-nums">{p.audits[0]?.score ?? "—"}</dd>
                </div>
              </dl>
              {p.audits[0] ? <p className="mt-2 text-[11px] text-muted-foreground">{t("marketing.seo.lastAudit", { date: formatDate(p.audits[0].createdAt, locale, tz) })}</p> : null}
            </Link>
          ))}
        </div>
      )}
    </MarketingShell>
  );
}
