import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { ActionButton } from "@/components/work/actions";
import { ProductTabs } from "@/components/work/area-tabs";
import { workContext } from "@/components/work/context";
import { ReleaseEditor, ReleaseForm } from "@/components/work/product-forms";
import { DeleteIconButton } from "@/components/work/task-forms";
import { Empty } from "@/components/work/ui";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { db } from "@/server/core/db";
import { listReleases } from "@/server/modules/work/product";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.product.tabs.releases") };
}

const RELEASE_TONE = { PLANNED: "neutral", IN_PROGRESS: "accent", RELEASED: "success" } as const;

export default async function ReleasesPage() {
  const t = await getT();
  const w = await workContext("projects", t("work.product.title"), t("work.product.subtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, base } = w;
  const [releases, features] = await Promise.all([
    listReleases(viewer.ctx, org.id, company.id),
    db().productFeature.findMany({ where: { organizationId: org.id, companyId: company.id, archivedAt: null, status: { not: "CANCELLED" } }, orderBy: { title: "asc" }, take: 500, select: { id: true, title: true } }),
  ]);
  const featureOpts = features.map((f) => ({ id: f.id, name: f.title }));
  const changelog = `/${locale}/changelog/${company.id}`;
  return (
    <div className="mx-auto grid max-w-[1100px] min-w-0 gap-4">
      {w.header}
      <ProductTabs t={t} locale={locale} active="releases" />
      <Card>
        <CardHeader
          title={t("work.product.tabs.releases")}
          description={t("work.product.releasesHint")}
          actions={
            <Link href={changelog} className="flex items-center gap-1 text-xs text-muted-foreground hover:underline" target="_blank">
              <ExternalLink className="size-3" aria-hidden />
              {t("work.product.publicChangelog")}
            </Link>
          }
        />
        {canManage ? (
          <details className="border-b">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("work.product.addRelease")}</summary>
            <ReleaseForm base={base} features={featureOpts} />
          </details>
        ) : null}
        {releases.length ? (
          <ul className="grid divide-y">
            {releases.map((r) => (
              <li key={r.id} className="grid gap-2 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{r.version}</span>
                  {r.name ? <span className="font-medium">{r.name}</span> : null}
                  <Badge tone={RELEASE_TONE[r.status]}>{t(`work.releaseStatus.${r.status}`)}</Badge>
                  {r.publishedAt ? <Badge tone="success">{t("work.product.published")}</Badge> : null}
                  <span className="text-xs text-muted-foreground">{r.releaseDate ? formatDate(r.releaseDate, locale, "UTC") : t("work.product.noDate")}</span>
                  <span className="ms-auto flex flex-wrap items-center gap-1">
                    {canManage && r.status === "RELEASED" ? (
                      <ActionButton url={`${base}/product/releases/${r.id}`} method="PATCH" body={{ published: !r.publishedAt }} variant="ghost" confirm={r.publishedAt ? undefined : t("work.product.confirmPublish")}>
                        {r.publishedAt ? t("work.product.unpublish") : t("work.product.publish")}
                      </ActionButton>
                    ) : null}
                    {canManage ? (
                      <ReleaseEditor
                        base={base}
                        releaseId={r.id}
                        features={[...featureOpts, ...r.features.filter((f) => !featureOpts.some((o) => o.id === f.id)).map((f) => ({ id: f.id, name: f.title }))]}
                        published={!!r.publishedAt}
                        initial={{ version: r.version, name: r.name ?? "", releaseDate: r.releaseDate ? r.releaseDate.toISOString().slice(0, 10) : "", status: r.status, notes: r.notes ?? "", featureIds: r.features.map((f) => f.id) }}
                      />
                    ) : null}
                    {canManage && !r.publishedAt ? <DeleteIconButton url={`${base}/product/releases/${r.id}`} label={t("work.delete")} confirm={t("work.confirmDelete")} /> : null}
                  </span>
                </div>
                {r.features.length ? (
                  <ul className="flex flex-wrap gap-1">
                    {r.features.map((f) => (
                      <li key={f.id}>
                        <Link href={`/${locale}/product/features/${f.id}`}>
                          <Badge>{f.title}</Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {r.notes ? <p className="whitespace-pre-wrap text-muted-foreground">{r.notes}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{t("work.product.noReleases")}</Empty>
        )}
      </Card>
    </div>
  );
}
