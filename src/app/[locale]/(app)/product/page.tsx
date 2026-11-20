import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { ActionButton, InlineSelect } from "@/components/work/actions";
import { ProductTabs } from "@/components/work/area-tabs";
import { workContext } from "@/components/work/context";
import { InitiativeForm } from "@/components/work/product-forms";
import { getT } from "@/i18n/server";
import { getRoadmap, ITEM_STATUSES, quarterOptions } from "@/server/modules/work/product";
import { ITEM_TONE } from "@/components/work/ui";
import { param } from "@/server/modules/work/shared";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.product.title") };
}


export default async function RoadmapPage({ searchParams }: PageProps<"/[locale]/product">) {
  const t = await getT();
  const w = await workContext("projects", t("work.product.title"), t("work.product.subtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, base } = w;
  const raw = await searchParams;
  const r = await getRoadmap(viewer.ctx, org.id, company.id, { start: param(raw, "start") });
  const quarters = quarterOptions();
  const cols = [...r.quarters, ""];
  const featuresIn = (q: string, initiativeId: string | null) => r.features.filter((f) => (f.quarter ?? "") === q && f.initiativeId === initiativeId);
  const shift = (n: number) => {
    let [y, q] = [Number(r.quarters[0]!.slice(0, 4)), Number(r.quarters[0]!.slice(6))];
    q += n;
    while (q > 4) {
      q -= 4;
      y++;
    }
    while (q < 1) {
      q += 4;
      y--;
    }
    return `/${locale}/product?start=${y}-Q${q}`;
  };
  const rows = [...r.initiatives.map((i) => ({ id: i.id as string | null, title: i.title, description: i.description, status: i.status, quarter: i.quarter })), { id: null, title: t("work.product.noInitiative"), description: null, status: null, quarter: null }];
  return (
    <div className="mx-auto grid max-w-[1600px] min-w-0 gap-4">
      {w.header}
      <ProductTabs t={t} locale={locale} active="roadmap" />
      <Card>
        <CardHeader
          title={t("work.product.roadmap")}
          description={t("work.product.roadmapHint")}
          actions={
            <span className="flex gap-2 text-xs">
              <Link href={shift(-1)} className="rounded-md border px-2 py-1 hover:bg-muted">
                {t("work.calendar.prev")}
              </Link>
              <Link href={`/${locale}/product`} className="rounded-md border px-2 py-1 hover:bg-muted">
                {t("work.product.thisQuarter")}
              </Link>
              <Link href={shift(1)} className="rounded-md border px-2 py-1 hover:bg-muted">
                {t("work.calendar.next")}
              </Link>
            </span>
          }
        />
        <div className="overflow-x-auto">
          <div className="grid min-w-[60rem] text-sm" style={{ gridTemplateColumns: `14rem repeat(${cols.length}, minmax(10rem, 1fr))` }}>
            <div className="border-b border-e bg-surface-2 px-3 py-2 text-xs font-medium text-muted-foreground">{t("work.product.initiative")}</div>
            {cols.map((q) => (
              <div key={q || "none"} className="border-b border-e bg-surface-2 px-3 py-2 text-xs font-medium text-muted-foreground">
                {q || t("work.product.unscheduled")}
              </div>
            ))}
            {rows.map((row) => (
              <div key={row.id ?? "none"} className="contents">
                <div className="grid content-start gap-1 border-b border-e p-3">
                  <span className="font-medium">{row.title}</span>
                  {row.description ? <span className="text-xs text-muted-foreground">{row.description}</span> : null}
                  {row.id && row.status ? (
                    canManage ? (
                      <InlineSelect url={`${base}/product/initiatives/${row.id}`} field="status" value={row.status} label={t("work.task.status")} options={ITEM_STATUSES.map((s) => ({ value: s, label: t(`work.itemStatus.${s}`) }))} />
                    ) : (
                      <Badge tone={ITEM_TONE[row.status]}>{t(`work.itemStatus.${row.status}`)}</Badge>
                    )
                  ) : null}
                  {row.id && canManage ? (
                    <InlineSelect url={`${base}/product/initiatives/${row.id}`} field="quarter" value={row.quarter ?? ""} label={t("work.product.quarter")} options={[{ value: "", label: t("work.product.unscheduled") }, ...quarters.map((q) => ({ value: q, label: q }))]} />
                  ) : row.quarter ? (
                    <span className="text-xs text-muted-foreground">{row.quarter}</span>
                  ) : null}
                  {row.id && canManage ? (
                    <ActionButton url={`${base}/product/initiatives/${row.id}`} method="PATCH" body={{ archived: true }} variant="ghost" confirm={t("work.confirmArchive")}>
                      {t("work.archive")}
                    </ActionButton>
                  ) : null}
                </div>
                {cols.map((q) => {
                  const items = featuresIn(q, row.id);
                  const span = row.id && row.quarter === q;
                  return (
                    <div key={q || "none"} className={`grid content-start gap-1 border-b border-e p-2 ${span ? "bg-accent/40" : ""}`}>
                      {items.map((f) => (
                        <Link key={f.id} href={`/${locale}/product/features/${f.id}`} className="grid gap-0.5 rounded-md border bg-surface p-2 text-xs hover:border-primary">
                          <span className="font-medium">{f.title}</span>
                          <span className="flex flex-wrap gap-1">
                            <Badge tone={ITEM_TONE[f.status]}>{t(`work.itemStatus.${f.status}`)}</Badge>
                            {f.riceScore != null ? <Badge>RICE {f.riceScore}</Badge> : null}
                            {f.release ? <Badge>{f.release.version}</Badge> : null}
                          </span>
                        </Link>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        {canManage ? (
          <details className="border-t">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("work.product.addInitiative")}</summary>
            <InitiativeForm base={base} quarters={quarters} />
          </details>
        ) : null}
      </Card>
    </div>
  );
}
