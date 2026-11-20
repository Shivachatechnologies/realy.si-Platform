import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { financePage } from "@/components/finance/page-context";
import { FormDialog, ResourceForm, type FieldSpec } from "@/components/finance/ui";
import { Empty, RangeForm, rangePresets } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { param, parseRange } from "@/server/modules/finance/common";
import { vendorSpend } from "@/server/modules/finance/setup";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.vendors") };
}

export default async function VendorsPage({ searchParams }: PageProps<"/[locale]/finance/vendors">) {
  const p = await financePage("vendors");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base } = p;
  const params = await searchParams;
  const range = parseRange(params);
  const q = param(params, "q")?.toLowerCase();
  const all = await vendorSpend(viewer.ctx, org.id, company.id, range.from, range.to);
  const vendors = (q ? all.filter((v) => v.name.toLowerCase().includes(q) || v.email?.toLowerCase().includes(q)) : all).sort((a, b) => (b.spendMinor > a.spendMinor ? 1 : b.spendMinor < a.spendMinor ? -1 : a.name.localeCompare(b.name)));
  const fields: FieldSpec[] = [
    { name: "name", label: t("finance.fields.name"), required: true, maxLength: 200 },
    { name: "email", label: t("finance.fields.email"), type: "email", maxLength: 254 },
    { name: "phone", label: t("finance.fields.phone"), maxLength: 40 },
    { name: "website", label: t("finance.fields.website"), maxLength: 300 },
    { name: "address", label: t("finance.fields.address"), type: "textarea", span: 2, maxLength: 1000 },
    { name: "notes", label: t("finance.fields.notes"), type: "textarea", span: 3, maxLength: 2000 },
  ];
  const path = `/${locale}/finance/vendors`;
  return p.frame(
    <>
      {p.canManage ? (
        <Card>
          <details>
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t("finance.vendors.add")}</summary>
            <div className="border-t p-4">
              <ResourceForm endpoint={`${base}/counterparties`} fields={fields} extra={{ type: "VENDOR" }} submitLabel={t("finance.vendors.add")} />
            </div>
          </details>
        </Card>
      ) : null}
      <RangeForm action={path} from={range.fromStr} to={range.toStr} labels={{ from: t("finance.range.from"), to: t("finance.range.to"), apply: t("finance.range.apply"), presets: rangePresets(t) }} hidden={q ? { q } : {}} />
      <Card>
        <CardHeader title={t("finance.tabs.vendors")} description={t("finance.vendors.hint")} />
        <form action={path} className="flex gap-2 border-b p-3">
          <input type="hidden" name="from" value={range.fromStr} />
          <input type="hidden" name="to" value={range.toStr} />
          <Input name="q" type="search" defaultValue={q ?? ""} maxLength={200} placeholder={t("finance.search")} aria-label={t("finance.search")} />
          <Button type="submit" variant="secondary">
            {t("finance.apply")}
          </Button>
        </form>
        {!vendors.length ? (
          <Empty>{q ? t("common.noResults") : t("finance.vendors.empty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.fields.name")}</Th>
                <Th>{t("finance.fields.email")}</Th>
                <Th className="text-end">{t("finance.vendors.transactions")}</Th>
                <Th className="text-end">{t("finance.vendors.spend")}</Th>
                <Th>
                  <span className="sr-only">{t("common.actions")}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {vendors.map((v) => (
                <Tr key={v.id}>
                  <Td>
                    <Link href={`/${locale}/finance/transactions?counterparty=${v.id}`} className="font-medium hover:underline">
                      {v.name}
                    </Link>
                  </Td>
                  <Td className="text-muted-foreground">{v.email ?? "—"}</Td>
                  <Td className="text-end tabular-nums">{v.transactions}</Td>
                  <Td className="text-end font-medium tabular-nums">{money(v.spendMinor)}</Td>
                  <Td>
                    {p.canManage ? (
                      <div className="flex justify-end">
                        <FormDialog trigger={t("finance.edit")} title={v.name}>
                          <ResourceForm endpoint={`${base}/counterparties/${v.id}`} method="PATCH" fields={fields} initial={{ name: v.name, email: v.email ?? "", phone: v.phone ?? "", website: v.website ?? "", address: v.address ?? "", notes: v.notes ?? "" }} submitLabel={t("common.save")} />
                        </FormDialog>
                      </div>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>,
  );
}
