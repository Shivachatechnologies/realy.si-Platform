import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { ActionButton } from "@/components/work/actions";
import { SmartEmpty } from "@/components/guide-kit/smart-empty";
import { AssetVisuals, OpsHeader, OpsIntro } from "@/components/ops-hub/ops-visuals";
import { CardBody } from "@/components/ui/card";
import { Package } from "lucide-react";
import { assetSummary } from "@/server/modules/cockpit/ops-insights";
import { workContext } from "@/components/work/context";
import { AssetEditor, AssetForm } from "@/components/work/ops-forms";
import { Empty, Pagination } from "@/components/work/ui";
import { getT } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n/format";
import { ASSET_STATUSES, listAssets } from "@/server/modules/work/operations";
import { listPeople, param } from "@/server/modules/work/shared";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.ops.tabs.assets") };
}

const ASSET_TONE = { AVAILABLE: "success", IN_USE: "accent", MAINTENANCE: "warning", RETIRED: "neutral" } as const;

export default async function AssetsPage({ searchParams }: PageProps<"/[locale]/operations/assets">) {
  const t = await getT();
  const w = await workContext("operations", t("work.ops.title"), t("work.ops.subtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, base } = w;
  const raw = await searchParams;
  const path = `/${locale}/operations/assets`;
  const [list, people, summary] = await Promise.all([listAssets(viewer.ctx, org.id, company.id, raw), canManage ? listPeople(viewer.ctx, org.id, company.id) : [], assetSummary(viewer.ctx, org.id, company.id)]);
  const filtered = !!(param(raw, "q") || param(raw, "status") || param(raw, "category") || param(raw, "archived"));
  const major = (m: bigint | null) => (m == null ? "" : `${m / 100n}${m % 100n ? `.${(m % 100n).toString().padStart(2, "0")}` : ""}`);
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      <OpsHeader t={t} locale={locale} active="assets" />
      <OpsIntro t={t} page="assets" next={canManage ? { label: t("work.ops.addAsset"), href: "#add" } : undefined} />
      {summary.total ? (
        <Card variant="elevated">
          <CardHeader icon={<Package />} title={t("opsHub.assets.title")} description={t("opsHub.assets.hint", { count: summary.total, categories: list.categories.length })} />
          <CardBody>
            <AssetVisuals summary={summary} value={list.value.length ? list.value.map((v) => formatMoney(v, locale)).join(" · ") : null} t={t} locale={locale} />
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("work.ops.tabs.assets")} description={t("work.ops.assetsHint")} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_10rem_9rem_auto]" action={path}>
          <Input name="q" type="search" defaultValue={param(raw, "q") ?? ""} maxLength={200} aria-label={t("work.search")} placeholder={t("work.ops.searchAssets")} />
          <Select name="status" defaultValue={param(raw, "status") ?? ""} aria-label={t("work.task.status")}>
            <option value="">{t("work.allStatuses")}</option>
            {ASSET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`work.ops.assetStatus.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="category" defaultValue={param(raw, "category") ?? ""} aria-label={t("work.ops.category")}>
            <option value="">{t("work.ops.allCategories")}</option>
            {list.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select name="sort" defaultValue={param(raw, "sort") ?? "name"} aria-label={t("work.sort")}>
            <option value="name">{t("work.sortTitle")}</option>
            <option value="status">{t("work.sortStatus")}</option>
            <option value="purchase">{t("work.ops.sortPurchase")}</option>
            <option value="created">{t("work.sortNewest")}</option>
          </Select>
          <Select name="archived" defaultValue={param(raw, "archived") ?? ""} aria-label={t("work.archived")}>
            <option value="">{t("work.activeOnly")}</option>
            <option value="1">{t("work.archived")}</option>
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
          <details className="scroll-mt-20 border-b" id="add" open={summary.total === 0}>
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("work.ops.addAsset")}</summary>
            <AssetForm base={base} people={people} currency={company.baseCurrency} />
          </details>
        ) : null}
        {list.data.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t("work.ops.assetName")}</Th>
                <Th>{t("work.ops.assetTag")}</Th>
                <Th>{t("work.task.status")}</Th>
                <Th>{t("work.ops.assignedTo")}</Th>
                <Th>{t("work.ops.location")}</Th>
                <Th>{t("work.ops.purchaseDate")}</Th>
                <Th className="text-end">{t("work.ops.costShort")}</Th>
                {canManage ? <Th /> : null}
              </Tr>
            </THead>
            <TBody>
              {list.data.map((a) => (
                <Tr key={a.id}>
                  <Td>
                    <span className="font-medium">{a.name}</span>
                    {a.category ? <span className="ms-2 text-xs text-muted-foreground">{a.category}</span> : null}
                    {a.serialNumber ? <p className="text-xs text-muted-foreground">{t("work.ops.serialShort", { serial: a.serialNumber })}</p> : null}
                  </Td>
                  <Td className="font-mono text-xs">{a.assetTag ?? "—"}</Td>
                  <Td>
                    <Badge tone={ASSET_TONE[a.status]}>{t(`work.ops.assetStatus.${a.status}`)}</Badge>
                  </Td>
                  <Td className="text-muted-foreground">{a.assignedToName ?? "—"}</Td>
                  <Td className="text-muted-foreground">{a.location ?? "—"}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{a.purchaseDate ? formatDate(a.purchaseDate, locale, "UTC") : "—"}</Td>
                  <Td className="text-end tabular-nums">{a.costMinor != null && a.currency ? formatMoney({ amountMinor: a.costMinor, currency: a.currency }, locale) : "—"}</Td>
                  {canManage ? (
                    <Td>
                      <span className="flex flex-wrap items-center gap-1">
                        <AssetEditor
                          base={base}
                          people={people}
                          currency={a.currency ?? company.baseCurrency}
                          assetId={a.id}
                          initial={{ name: a.name, assetTag: a.assetTag ?? "", category: a.category ?? "", serialNumber: a.serialNumber ?? "", location: a.location ?? "", status: a.status, assignedToId: a.assignedToId ?? "", purchaseDate: iso(a.purchaseDate), cost: major(a.costMinor), notes: a.notes ?? "" }}
                        />
                        <ActionButton url={`${base}/operations/assets/${a.id}`} method="PATCH" body={{ archived: !a.archivedAt }} variant="ghost" confirm={a.archivedAt ? undefined : t("work.confirmArchive")}>
                          {a.archivedAt ? t("work.restore") : t("work.archive")}
                        </ActionButton>
                      </span>
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          filtered ? (
            <Empty>{t("common.noResults")}</Empty>
          ) : (
            <SmartEmpty icon={<Package />} title={t("opsHub.empty.assets.title")} body={t("opsHub.empty.assets.body")} />
          )
        )}
        <Pagination path={path} params={raw} page={list.page} pageSize={list.pageSize} total={list.total} labels={{ prev: t("common.previous"), next: t("common.next"), summary: t("work.pageOf", { page: list.page, pages: Math.max(1, Math.ceil(list.total / list.pageSize)) }) }} />
      </Card>
    </div>
  );
}
