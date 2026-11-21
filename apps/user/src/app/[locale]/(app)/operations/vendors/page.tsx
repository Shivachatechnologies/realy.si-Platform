import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { SmartEmpty } from "@/components/guide-kit/smart-empty";
import { OpsHeader, OpsIntro } from "@/components/ops-hub/ops-visuals";
import { Truck } from "lucide-react";
import { workContext } from "@/components/work/context";
import { Empty, Pagination } from "@/components/work/ui";
import { getT } from "@/i18n/server";
import { displayName } from "@/i18n/format";
import { listVendors } from "@/server/modules/work/operations";
import { param } from "@/server/modules/work/shared";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.ops.tabs.vendors") };
}

/** Vendors are CRM accounts of type VENDOR (owned by the CRM module): listed read-only with a link to the account. */
export default async function VendorsPage({ searchParams }: PageProps<"/[locale]/operations/vendors">) {
  const t = await getT();
  const w = await workContext("operations", t("work.ops.title"), t("work.ops.subtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company } = w;
  const raw = await searchParams;
  const path = `/${locale}/operations/vendors`;
  const list = await listVendors(viewer.ctx, org.id, company.id, raw);
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      <OpsHeader t={t} locale={locale} active="vendors" />
      <OpsIntro t={t} page="vendors" next={{ label: t("opsHub.intro.vendors.next"), href: `/${locale}/crm/accounts` }} />
      <Card>
        <CardHeader
          title={t("work.ops.tabs.vendors")}
          description={t("work.ops.vendorsHint")}
          actions={
            <Link href={`/${locale}/customers`} className="text-xs text-muted-foreground hover:underline">
              {t("work.ops.manageInCrm")}
            </Link>
          }
        />
        <form className="flex gap-2 border-b p-3" action={path}>
          <Input name="q" type="search" defaultValue={param(raw, "q") ?? ""} maxLength={200} aria-label={t("work.search")} placeholder={t("work.ops.searchVendors")} />
          <Button type="submit" variant="secondary">
            {t("work.apply")}
          </Button>
        </form>
        {list.data.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t("work.ops.vendor")}</Th>
                <Th>{t("work.ops.industry")}</Th>
                <Th>{t("work.ops.contact")}</Th>
                <Th>{t("work.ops.country")}</Th>
                <Th className="text-end">{t("work.ops.contacts")}</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data.map((v) => (
                <Tr key={v.id}>
                  <Td>
                    <Link href={`/${locale}/crm/accounts/${v.id}`} className="font-medium hover:underline">
                      {v.name}
                    </Link>
                    {v.website || v.domain ? <p className="text-xs text-muted-foreground">{v.website ?? v.domain}</p> : null}
                  </Td>
                  <Td className="text-muted-foreground">{v.industry ?? "—"}</Td>
                  <Td className="text-muted-foreground">{[v.email, v.phone].filter(Boolean).join(" · ") || "—"}</Td>
                  <Td className="text-muted-foreground">{v.countryCode ? displayName(v.countryCode, "region", locale) : "—"}</Td>
                  <Td className="text-end tabular-nums">{v._count.contacts}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          param(raw, "q") ? (
            <Empty>{t("common.noResults")}</Empty>
          ) : (
            <SmartEmpty icon={<Truck />} title={t("opsHub.empty.vendors.title")} body={t("opsHub.empty.vendors.body")} primary={<Link href={`/${locale}/crm/accounts`} className="text-sm font-medium text-primary hover:underline">{t("opsHub.intro.vendors.next")}</Link>} />
          )
        )}
        <Pagination path={path} params={raw} page={list.page} pageSize={list.pageSize} total={list.total} labels={{ prev: t("common.previous"), next: t("common.next"), summary: t("work.pageOf", { page: list.page, pages: Math.max(1, Math.ceil(list.total / list.pageSize)) }) }} />
      </Card>
    </div>
  );
}
