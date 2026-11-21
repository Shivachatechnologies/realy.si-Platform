import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { HelpStrip, LifecycleRail, StudioHero } from "@/components/work/product-studio";
import { db } from "@/server/core/db";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { workContext } from "@/components/work/context";
import { ProductForm } from "@/components/work/product-client";
import { ProductAreaTabs } from "@/components/work/product-nav";
import { PRODUCT_STATUS_TONE, StageBadge } from "@/components/work/product-ui";
import { Empty, Pagination } from "@/components/work/ui";
import { SmartEmpty } from "@/components/builder/smart-empty";
import { formatDate } from "@/i18n/format";
import { getT } from "@/i18n/server";
import { listProducts, parseProductFilters, PRODUCT_STAGES, PRODUCT_STATUSES, productFormPickers, stageIndex } from "@/server/modules/work/product-core";
import { listPeople } from "@/server/modules/work/shared";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.product.title") };
}

export default async function ProductsPage({ searchParams }: PageProps<"/[locale]/product">) {
  const t = await getT();
  const w = await workContext("projects", t("work.product.title"), t("product.subtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, base, tz } = w;
  const raw = await searchParams;
  const filters = parseProductFilters(raw);
  const path = `/${locale}/product`;
  const [list, pickers, people] = await Promise.all([
    listProducts(viewer.ctx, org.id, company.id, filters),
    canManage ? productFormPickers(org.id, company.id) : { entities: [], projects: [] },
    canManage ? listPeople(viewer.ctx, org.id, company.id) : [],
  ]);
  const filtered = !!(filters.q || filters.stage || filters.status || filters.archived);
  const byStage = await db().product.groupBy({ by: ["stage"], where: { organizationId: org.id, companyId: company.id, archivedAt: null }, _count: { _all: true } });
  const sum = (from: number, to: number) => byStage.filter((x) => stageIndex(x.stage) >= from && stageIndex(x.stage) <= to).reduce((a, x) => a + x._count._all, 0);
  const stats = { total: sum(0, 12), discovery: sum(0, 4), building: sum(5, 9), launched: sum(10, 12) };
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      <StudioHero
        eyebrow={t("product.studio")}
        title={t("product.studioTitle")}
        description={t("product.studioSubtitle")}
        actions={
          canManage ? (
            <Link href={`${path}/start`} className="press inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90">
              <Sparkles className="size-4" aria-hidden />
              {t("product.startHere")}
            </Link>
          ) : null
        }
      >
        <StatGrid>
          <StatTile label={t("product.stats.products")} value={stats.total} index={0} />
          <StatTile label={t("product.stats.discovery")} value={stats.discovery} hint={t("product.stats.discoveryHint")} index={1} />
          <StatTile label={t("product.stats.building")} value={stats.building} hint={t("product.stats.buildingHint")} index={2} />
          <StatTile label={t("product.stats.launched")} value={stats.launched} hint={t("product.stats.launchedHint")} index={3} />
        </StatGrid>
      </StudioHero>
      <ProductAreaTabs t={t} locale={locale} active="products" />
      <HelpStrip t={t} area="portfolio" />
      <Card>
        <CardHeader title={t("product.tabs.products")} description={t("product.count", { count: list.total })} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_12rem_10rem_10rem_auto]" action={path}>
          <Input name="q" type="search" defaultValue={filters.q ?? ""} maxLength={200} aria-label={t("work.search")} placeholder={t("product.search")} />
          <Select name="stage" defaultValue={filters.stage ?? ""} aria-label={t("product.stage")}>
            <option value="">{t("product.allStages")}</option>
            {PRODUCT_STAGES.map((s) => (
              <option key={s} value={s}>
                {t(`product.stages.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="status" defaultValue={filters.status ?? ""} aria-label={t("work.task.status")}>
            <option value="">{t("work.allStatuses")}</option>
            {PRODUCT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`product.status.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="sort" defaultValue={filters.sort} aria-label={t("work.sort")}>
            <option value="updated">{t("product.sortUpdated")}</option>
            <option value="created">{t("work.sortNewest")}</option>
            <option value="name">{t("work.sortTitle")}</option>
            <option value="stage">{t("product.sortStage")}</option>
          </Select>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" name="archived" value="1" defaultChecked={filters.archived} />
              {t("product.showArchived")}
            </label>
            <Button type="submit" variant="secondary">
              {t("work.apply")}
            </Button>
            {filtered ? (
              <Link href={path} className="text-xs text-muted-foreground hover:underline">
                {t("work.clear")}
              </Link>
            ) : null}
          </div>
        </form>
        {canManage ? (
          <details className="border-b" open={list.total === 0 && !filtered}>
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("product.create")}</summary>
            <div className="p-3">
              <ProductForm base={base} locale={locale} people={people} entities={pickers.entities} projects={pickers.projects} />
            </div>
          </details>
        ) : null}
        {list.data.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t("product.fields.name")}</Th>
                <Th>{t("product.stage")}</Th>
                <Th>{t("work.task.status")}</Th>
                <Th>{t("product.fields.owner")}</Th>
                <Th>{t("product.fields.project")}</Th>
                <Th className="text-end">{t("product.linked")}</Th>
                <Th>{t("product.inStageSince")}</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <Link href={`${path}/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    {p.targetUsers ? <p className="max-w-80 truncate text-xs text-muted-foreground">{p.targetUsers}</p> : null}
                    <div className="mt-1 w-56 max-w-full">
                      <LifecycleRail t={t} stage={p.stage} compact />
                    </div>
                  </Td>
                  <Td>
                    <StageBadge t={t} stage={p.stage} />
                  </Td>
                  <Td>
                    <Badge tone={PRODUCT_STATUS_TONE[p.status]}>{t(`product.status.${p.status}`)}</Badge>
                  </Td>
                  <Td className="text-muted-foreground">{p.ownerName ?? "—"}</Td>
                  <Td className="text-muted-foreground">
                    {p.developmentProject ? (
                      <Link href={`/${locale}/projects/${p.developmentProject.id}`} className="hover:underline">
                        {p.developmentProject.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="text-end text-xs text-muted-foreground">{t("product.linkedCounts", { features: p._count.features, docs: p._count.docs, releases: p._count.releases, feedback: p._count.feedback })}</Td>
                  <Td className="text-xs text-muted-foreground">{formatDate(p.stageEnteredAt, locale, tz)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          filtered ? (
            <Empty>{t("common.noResults")}</Empty>
          ) : (
            <SmartEmpty
              title={t("product.emptyTitle")}
              hint={t("product.emptyHint")}
              steps={[t("productStudio.smartEmpty.step1"), t("productStudio.smartEmpty.step2"), t("productStudio.smartEmpty.step3")]}
              help={t("productStudio.smartEmpty.help")}
              href={canManage ? `${path}/start` : null}
            />
          )
        )}
        <Pagination path={path} params={raw} page={list.page} pageSize={list.pageSize} total={list.total} labels={{ prev: t("common.previous"), next: t("common.next"), summary: t("work.pageOf", { page: list.page, pages: Math.max(1, Math.ceil(list.total / list.pageSize)) }) }} />
      </Card>
    </div>
  );
}
