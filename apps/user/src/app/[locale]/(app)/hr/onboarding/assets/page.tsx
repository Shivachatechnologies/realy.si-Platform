import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { ActionButton } from "@/components/hr/hr-action";
import { HrForm } from "@/components/hr/hr-form";
import { enumOptions, peopleOptions } from "@/components/hr/options";
import { HrFrame, loadHr, personName } from "@/components/hr/shell";
import { formatDate, formatMoney } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { enumParam, oneParam } from "@/server/modules/hr/access";
import { employeeOptions } from "@/server/modules/hr/employees";
import { ASSET_STATUSES, listAssets } from "@/server/modules/hr/onboarding";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.assets.register") };
}

const TONE = { AVAILABLE: "success", ASSIGNED: "accent", MAINTENANCE: "warning", RETIRED: "neutral" } as const;

export default async function AssetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const { t, viewer, org, company, access, base, tz } = await loadHr(locale);
  const allowed = !!access?.manage;
  const frame = { t, locale, title: t("hr.assets.register"), subtitle: t("hr.assets.subtitle"), tab: "onboarding" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const raw = await searchParams;
  const filters = { q: oneParam(raw, "q"), status: enumParam(raw, "status", ASSET_STATUSES) };
  const [assets, people] = await Promise.all([listAssets(viewer.ctx, org.id, company.id, filters), employeeOptions(viewer.ctx, org.id, company.id)]);
  return (
    <HrFrame {...frame} actions={<Link href={`/${locale}/hr/onboarding`} className="text-sm text-muted-foreground hover:underline">{t("hr.onboarding.title")}</Link>}>
      <Card>
        <CardHeader title={t("hr.assets.title")} description={t("hr.assets.count", { count: assets.length })} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]" action={`/${locale}/hr/onboarding/assets`}>
          <Input name="q" type="search" defaultValue={filters.q ?? ""} placeholder={t("hr.assets.searchPlaceholder")} aria-label={t("hr.search")} />
          <Select name="status" defaultValue={filters.status ?? ""} aria-label={t("common.status")}>
            <option value="">{t("common.all")}</option>
            {ASSET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`hr.assetStatus.${s}`)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {t("hr.apply")}
          </Button>
        </form>
        <details className="border-b">
          <summary className="cursor-pointer p-3 text-sm font-medium">{t("hr.assets.add")}</summary>
          <HrForm
            className="px-3 pb-3"
            columns={3}
            endpoint={`${base}/hr/assets`}
            fields={[
              { name: "name", label: t("hr.org.name"), required: true },
              { name: "tag", label: t("hr.assets.tag"), required: true },
              { name: "category", label: t("hr.assets.category"), required: true, placeholder: "laptop" },
              { name: "serialNumber", label: t("hr.assets.serial") },
              { name: "purchaseDate", label: t("hr.assets.purchaseDate"), type: "date" },
              { name: "value", label: t("hr.assets.value", { currency: company.baseCurrency }), type: "money" },
              { name: "notes", label: t("hr.note"), type: "textarea", rows: 2 },
            ]}
            initial={{ category: "laptop" }}
            submitLabel={t("common.create")}
          />
        </details>
        {assets.length ? (
          <ul className="grid divide-y">
            {assets.map((a) => {
              const current = a.assignments.find((x) => !x.returnedAt);
              return (
                <li key={a.id} className="grid gap-2 px-3 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.name}</span>
                    <Badge>{a.tag}</Badge>
                    <span className="text-xs text-muted-foreground">{[a.category, a.serialNumber, a.valueMinor != null && a.currency ? formatMoney({ amountMinor: a.valueMinor, currency: a.currency }, locale) : null].filter(Boolean).join(" · ")}</span>
                    <Badge tone={TONE[a.status]}>{t(`hr.assetStatus.${a.status}`)}</Badge>
                    {current ? (
                      <Link href={`/${locale}/hr/employees/${current.employee.id}`} className="text-xs hover:underline">
                        {personName(current.employee)}
                      </Link>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-start gap-3">
                    {a.status === "AVAILABLE" ? (
                      <HrForm className="w-full max-w-md" columns={2} endpoint={`${base}/hr/assets/${a.id}/assign`} extra={{ action: "assign" }} fields={[{ name: "employeeId", label: t("hr.assets.assignTo"), type: "select", required: true, options: peopleOptions(people) }, { name: "notes", label: t("hr.note") }]} submitLabel={t("hr.assets.assign")} />
                    ) : null}
                    {a.status === "ASSIGNED" ? <ActionButton endpoint={`${base}/hr/assets/${a.id}/assign`} body={{ action: "return" }} label={t("hr.assets.return")} /> : null}
                    {a.status !== "ASSIGNED" ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground">{t("hr.assets.changeStatus")}</summary>
                        <HrForm className="mt-2" columns={1} method="PATCH" endpoint={`${base}/hr/assets/${a.id}`} fields={[{ name: "status", label: t("common.status"), type: "select", required: true, options: enumOptions(t, "hr.assetStatus", ["AVAILABLE", "MAINTENANCE", "RETIRED"]) }]} initial={{ status: a.status }} submitLabel={t("common.save")} />
                      </details>
                    ) : null}
                  </div>
                  {a.assignments.length ? (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground">{t("hr.assets.history", { count: a.assignments.length })}</summary>
                      <ul className="mt-1 grid gap-0.5 text-xs">
                        {a.assignments.map((x) => (
                          <li key={x.id}>
                            {personName(x.employee)}: {formatDate(x.assignedAt, locale, tz)} – {x.returnedAt ? formatDate(x.returnedAt, locale, tz) : t("hr.assets.current")}
                            {x.notes ? ` · ${x.notes}` : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{filters.q || filters.status ? t("common.noResults") : t("hr.assets.empty")}</p>
        )}
      </Card>
    </HrFrame>
  );
}
