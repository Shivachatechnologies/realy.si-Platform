import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { ProductTabs } from "@/components/work/area-tabs";
import { workContext } from "@/components/work/context";
import { Empty } from "@/components/work/ui";
import { getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { listFeatures, parseFeatureFilters } from "@/server/modules/work/product";
import { param } from "@/server/modules/work/shared";
import { ITEM_TONE } from "@/components/work/ui";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.product.tabs.prioritization") };
}

const COLS = ["rice", "reach", "impact", "confidence", "effort", "title"] as const;
type Col = (typeof COLS)[number];

export default async function PrioritizationPage({ searchParams }: PageProps<"/[locale]/product/prioritization">) {
  const t = await getT();
  const w = await workContext("projects", t("work.product.title"), t("work.product.subtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company } = w;
  const raw = await searchParams;
  const sort = (COLS as readonly string[]).includes(param(raw, "sort") ?? "") ? (param(raw, "sort") as Col) : "rice";
  const dir = param(raw, "dir") === "asc" ? 1 : -1;
  const list = await listFeatures(viewer.ctx, org.id, company.id, { ...parseFeatureFilters({}), sort: "rice" });
  // Open features only; RICE inputs sorted client-requested (nulls last).
  const rows = list.data.filter((f) => f.status !== "SHIPPED" && f.status !== "CANCELLED");
  const val = (f: (typeof rows)[number]): number | string | null => (sort === "rice" ? f.riceScore : sort === "title" ? f.title : f[sort]);
  rows.sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(String(y)) : x - Number(y)) * (sort === "title" ? -dir : dir);
  });
  const head = (key: Col, label: string, end = true) => (
    <Th className={end ? "text-end" : undefined}>
      <Link href={`/${locale}/product/prioritization?sort=${key}&dir=${sort === key && dir === -1 ? "asc" : "desc"}`} className="hover:text-foreground">
        {label}
        {sort === key ? (dir === -1 ? " ↓" : " ↑") : ""}
      </Link>
    </Th>
  );
  const unscored = rows.filter((r) => r.riceScore == null).length;
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      {w.header}
      <ProductTabs t={t} locale={locale} active="prioritization" />
      <Card>
        <CardHeader title={t("work.product.prioritization")} description={t("work.product.riceFormula")} />
        {unscored ? (
          <CardBody className="border-b py-2">
            <p className="text-xs text-muted-foreground">{t("work.product.unscored", { count: unscored })}</p>
          </CardBody>
        ) : null}
        {rows.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>#</Th>
                {head("title", t("work.product.featureTitle"), false)}
                <Th>{t("work.task.status")}</Th>
                {head("reach", t("work.product.reach"))}
                {head("impact", t("work.product.impact"))}
                {head("confidence", t("work.product.confidence"))}
                {head("effort", t("work.product.effort"))}
                {head("rice", t("work.product.riceScore"))}
              </Tr>
            </THead>
            <TBody>
              {rows.map((f, i) => (
                <Tr key={f.id}>
                  <Td className="text-muted-foreground tabular-nums">{i + 1}</Td>
                  <Td>
                    <Link href={`/${locale}/product/features/${f.id}`} className="font-medium hover:underline">
                      {f.title}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={ITEM_TONE[f.status]}>{t(`work.itemStatus.${f.status}`)}</Badge>
                  </Td>
                  <Td className="text-end tabular-nums">{f.reach != null ? formatNumber(f.reach, locale) : "—"}</Td>
                  <Td className="text-end tabular-nums">{f.impact ?? "—"}</Td>
                  <Td className="text-end tabular-nums">{f.confidence != null ? `${f.confidence}%` : "—"}</Td>
                  <Td className="text-end tabular-nums">{f.effort ?? "—"}</Td>
                  <Td className="text-end font-semibold tabular-nums">{f.riceScore != null ? formatNumber(f.riceScore, locale) : "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>{t("work.product.noFeatures")}</Empty>
        )}
        {list.total > list.pageSize ? <p className="border-t p-3 text-xs text-muted-foreground">{t("work.product.topOnly", { count: list.pageSize })}</p> : null}
      </Card>
    </div>
  );
}
