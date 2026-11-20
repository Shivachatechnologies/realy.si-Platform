import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { workContext } from "@/components/work/context";
import { ProductAreaTabs } from "@/components/work/product-nav";
import { PRODUCT_STATUS_TONE } from "@/components/work/product-ui";
import { HelpStrip } from "@/components/work/product-studio";
import { formatDate } from "@/i18n/format";
import { getT } from "@/i18n/server";
import { stageBoard } from "@/server/modules/work/product-core";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("product.tabs.board") };
}

/** Current lifecycle stage of every active product, as a board. */
export default async function StageBoardPage() {
  const t = await getT();
  const w = await workContext("projects", t("work.product.title"), t("product.subtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, tz } = w;
  const board = await stageBoard(viewer.ctx, org.id, company.id);
  const total = board.reduce((s, c) => s + c.products.length, 0);
  return (
    <div className="mx-auto grid max-w-[1800px] min-w-0 gap-4">
      {w.header}
      <ProductAreaTabs t={t} locale={locale} active="board" />
      <HelpStrip t={t} area="board" />
      <Card>
        <CardHeader title={t("product.tabs.board")} description={t("product.boardHint", { count: total })} />
        {total ? (
          <div className="overflow-x-auto p-3">
            <div className="flex min-w-max gap-3">
              {board.map((col) => (
                <section key={col.stage} className="grid w-56 shrink-0 content-start gap-2 rounded-lg border bg-surface-2 p-2" aria-label={t(`product.stages.${col.stage}`)}>
                  <h2 className="flex items-center justify-between px-1 text-xs font-medium text-muted-foreground">
                    {t(`product.stages.${col.stage}`)}
                    <span className="tabular-nums">{col.products.length}</span>
                  </h2>
                  {col.products.map((p) => (
                    <Link key={p.id} href={`/${locale}/product/${p.id}`} className="hover-lift grid gap-1 rounded-md border bg-surface p-2 text-xs hover:border-primary">
                      <span className="text-sm font-medium">{p.name}</span>
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={PRODUCT_STATUS_TONE[p.status]}>{t(`product.status.${p.status}`)}</Badge>
                        <Badge tone={p.gateApproved ? "success" : p.gateDone === p.gateTotal ? "warning" : "neutral"}>
                          {p.gateApproved ? t("product.gate.approved") : t("product.gate.progress", { done: p.gateDone, total: p.gateTotal })}
                        </Badge>
                      </span>
                      <span className="text-muted-foreground">{p.ownerName ?? t("product.noOwner")}</span>
                      <span className="text-muted-foreground">{t("product.sinceDate", { date: formatDate(p.stageEnteredAt, locale, tz) })}</span>
                    </Link>
                  ))}
                </section>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid justify-items-center gap-2 p-8 text-center text-sm">
            <p className="font-semibold">{t("product.emptyTitle")}</p>
            <Link href={`/${locale}/product/start`} className="text-primary hover:underline">
              {t("product.emptyAction")}
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
