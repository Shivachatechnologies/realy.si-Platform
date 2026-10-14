import type { Metadata } from "next";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { NewCompanyDialog } from "@/components/company/new-company-dialog";
import { getLocale, getT } from "@/i18n/server";
import { displayName, formatDate, formatList } from "@/i18n/format";
import { can } from "@/server/modules/rbac/service";
import { orgChain } from "@/server/modules/rbac/scope";
import { companyFormOptions } from "@/server/modules/globalization/options";
import { requireOrgContext } from "@/server/workspace";
import { db } from "@/server/core/db";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("company.title") };
}

export default async function CompaniesPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, companies } = await requireOrgContext(locale);
  const [canCreate, options, workspaceCounts] = await Promise.all([
    can(viewer.ctx, "companies.manage", orgChain(org.id)),
    companyFormOptions(),
    db().workspace.groupBy({ by: ["companyId"], where: { organizationId: org.id }, _count: true }),
  ]);
  const country = (c: string) => displayName(c, "region", locale);

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-lg font-semibold tracking-tight">{t("company.title")}</h1>
          <p className="text-muted-foreground">{t("company.subtitle")}</p>
        </div>
        {canCreate ? <NewCompanyDialog countries={options.countries} currencies={options.currencies} organizationId={org.id} /> : null}
      </div>
      <Card>
        <CardHeader title={org.name} />
        {companies.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("company.columns.name")}</Th>
                <Th>{t("company.columns.incorporation")}</Th>
                <Th>{t("company.columns.markets")}</Th>
                <Th>{t("company.columns.currency")}</Th>
                <Th>{t("company.columns.region")}</Th>
                <Th>{t("company.workspaces")}</Th>
                <Th>{t("company.columns.created")}</Th>
              </Tr>
            </THead>
            <TBody>
              {companies.map((c) => (
                <Tr key={c.id}>
                  <Td className="font-medium">
                    {c.name}
                    {c.legalName ? <div className="text-xs font-normal text-muted-foreground">{c.legalName}</div> : null}
                  </Td>
                  <Td>{c.incorporationCountryCode ? country(c.incorporationCountryCode) : "—"}</Td>
                  <Td className="max-w-64 truncate">{c.targetMarketCodes.length ? formatList(c.targetMarketCodes.map(country), locale) : "—"}</Td>
                  <Td className="font-mono text-xs">{c.baseCurrency}</Td>
                  <Td>
                    <Badge>{t(`onboarding.dataRegions.${c.dataRegion}`)}</Badge>
                  </Td>
                  <Td className="tabular">{workspaceCounts.find((w) => w.companyId === c.id)?._count ?? 0}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{formatDate(c.createdAt, locale, viewer.user.timezone)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
