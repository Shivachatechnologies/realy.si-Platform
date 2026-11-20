import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { ProductTabs } from "@/components/work/area-tabs";
import { workContext } from "@/components/work/context";
import { FeatureForm } from "@/components/work/product-forms";
import { Empty, Pagination } from "@/components/work/ui";
import { getT } from "@/i18n/server";
import { featurePickers, ITEM_STATUSES, listFeatures, parseFeatureFilters, quarterOptions } from "@/server/modules/work/product";
import { ITEM_TONE } from "@/components/work/ui";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.product.tabs.features") };
}

export default async function FeaturesPage({ searchParams }: PageProps<"/[locale]/product/features">) {
  const t = await getT();
  const w = await workContext("projects", t("work.product.title"), t("work.product.subtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, base } = w;
  const raw = await searchParams;
  const filters = parseFeatureFilters(raw);
  const path = `/${locale}/product/features`;
  const [list, pickers] = await Promise.all([listFeatures(viewer.ctx, org.id, company.id, filters), featurePickers(org.id, company.id)]);
  const filtered = !!(filters.q || filters.status || filters.initiativeId);
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      {w.header}
      <ProductTabs t={t} locale={locale} active="features" />
      <Card>
        <CardHeader title={t("work.product.tabs.features")} description={t("work.product.featureCount", { count: list.total })} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_10rem_12rem_10rem_auto]" action={path}>
          <Input name="q" type="search" defaultValue={filters.q ?? ""} maxLength={200} aria-label={t("work.search")} placeholder={t("work.product.searchFeatures")} />
          <Select name="status" defaultValue={filters.status ?? ""} aria-label={t("work.task.status")}>
            <option value="">{t("work.allStatuses")}</option>
            {ITEM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`work.itemStatus.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="initiative" defaultValue={filters.initiativeId ?? ""} aria-label={t("work.product.initiative")}>
            <option value="">{t("work.product.allInitiatives")}</option>
            {pickers.initiatives.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
          <Select name="sort" defaultValue={filters.sort} aria-label={t("work.sort")}>
            <option value="created">{t("work.sortNewest")}</option>
            <option value="rice">{t("work.product.sortRice")}</option>
            <option value="title">{t("work.sortTitle")}</option>
            <option value="status">{t("work.sortStatus")}</option>
          </Select>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary">
              {t("work.apply")}
            </Button>
            {filtered ? (
              <Link href={path} className="self-center text-xs text-muted-foreground hover:underline">
                {t("work.clear")}
              </Link>
            ) : null}
          </div>
        </form>
        {canManage ? (
          <details className="border-b">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("work.product.addFeature")}</summary>
            <div className="p-3">
              <FeatureForm base={base} locale={locale} quarters={quarterOptions()} {...pickers} />
            </div>
          </details>
        ) : null}
        {list.data.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t("work.product.featureTitle")}</Th>
                <Th>{t("work.task.status")}</Th>
                <Th>{t("work.product.initiative")}</Th>
                <Th>{t("work.product.quarter")}</Th>
                <Th>{t("work.product.release")}</Th>
                <Th className="text-end">{t("work.product.riceScore")}</Th>
                <Th className="text-end">{t("work.product.linked")}</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data.map((f) => (
                <Tr key={f.id}>
                  <Td>
                    <Link href={`/${locale}/product/features/${f.id}`} className="font-medium hover:underline">
                      {f.title}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={ITEM_TONE[f.status]}>{t(`work.itemStatus.${f.status}`)}</Badge>
                  </Td>
                  <Td className="text-muted-foreground">{f.initiative?.title ?? "—"}</Td>
                  <Td className="text-muted-foreground">{f.quarter ?? "—"}</Td>
                  <Td className="text-muted-foreground">{f.release?.version ?? "—"}</Td>
                  <Td className="text-end tabular-nums">{f.riceScore ?? "—"}</Td>
                  <Td className="text-end text-xs text-muted-foreground">{t("work.product.linkedCounts", { tasks: f._count.tasks, feedback: f._count.feedback, ideas: f._count.ideas })}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>{filtered ? t("common.noResults") : t("work.product.noFeatures")}</Empty>
        )}
        <Pagination path={path} params={raw} page={list.page} pageSize={list.pageSize} total={list.total} labels={{ prev: t("common.previous"), next: t("common.next"), summary: t("work.pageOf", { page: list.page, pages: Math.max(1, Math.ceil(list.total / list.pageSize)) }) }} />
      </Card>
    </div>
  );
}
