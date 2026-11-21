import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { ScopeArtwork } from "@/components/assets/scope-artwork";
import { WorldIllustration } from "@/components/graphics/illustrations";
import { CompanyProfileForm, SwitchCompanyButton, Workspaces } from "@/components/enterprise/company-profile";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { NewCompanyDialog } from "@/components/company/new-company-dialog";
import { CompanyTabs } from "@/components/objectives/tabs";
import { getLocale, getT } from "@/i18n/server";
import { displayName, formatDate, formatList, formatNumber } from "@/i18n/format";
import { can } from "@/server/modules/rbac/service";
import { companyChain, orgChain } from "@/server/modules/rbac/scope";
import { companyFormOptions } from "@/server/modules/globalization/options";
import { getCompanyProfile, listCompanyWorkspaces } from "@/server/modules/enterprise/company";
import { getOrgLimits } from "@/server/modules/enterprise/policy";
import { requireOrgContext } from "@/server/workspace";
import { db } from "@/server/core/db";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("company.title") };
}

export default async function CompaniesPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, companies, company } = await requireOrgContext(locale);
  const [canCreate, options, workspaceCounts, limits] = await Promise.all([
    can(viewer.ctx, "companies.manage", orgChain(org.id)),
    companyFormOptions(),
    db().workspace.groupBy({
      by: ["companyId"],
      where: { organizationId: org.id },
      _count: true,
    }),
    getOrgLimits(org.id),
  ]);
  const chain = company ? await companyChain(db(), org.id, company.id) : null;
  const [profile, workspaces, canManageCompany, canManageWorkspaces] = await Promise.all([
    company ? getCompanyProfile(viewer.ctx, org.id, company.id).catch(() => null) : Promise.resolve(null),
    company ? listCompanyWorkspaces(viewer.ctx, org.id, company.id).catch(() => null) : Promise.resolve(null),
    chain ? can(viewer.ctx, "companies.manage", chain) : Promise.resolve(false),
    chain ? can(viewer.ctx, "workspaces.manage", chain) : Promise.resolve(false),
  ]);
  const country = (c: string) => displayName(c, "region", locale);
  const atLimit = limits.maxCompanies !== null && companies.length >= limits.maxCompanies;
  const base = company ? `/api/v1/organizations/${org.id}/companies/${company.id}` : "";

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      <div className="flex items-start justify-between gap-4">
        <PageHeader variant="editorial" world="command" illustration={<ScopeArtwork scopeType="BRAND" ratio="3:2" className="w-full max-w-[19rem]" fallback={<WorldIllustration world="command" className="w-full max-w-[19rem]" />} />} eyebrow={t("dna.worlds.command")} title={t("company.title")} description={t("company.subtitle")} />
        {canCreate && !atLimit ? <NewCompanyDialog countries={options.countries} currencies={options.currencies} organizationId={org.id} /> : null}
      </div>
      {company ? <CompanyTabs locale={locale} active="profile" /> : null}
      {canCreate && atLimit ? (
        <Notice tone="warning">
          {t("enterprise.company.limitReached", {
            limit: formatNumber(limits.maxCompanies!, locale),
          })}
        </Notice>
      ) : null}

      {company && profile ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card>
            <CardHeader
              title={t("enterprise.company.profileTitle", {
                company: company.name,
              })}
              description={
                profile.profile.currencyConfirmedAt
                  ? t("enterprise.company.currencyConfirmedOn", {
                      currency: company.baseCurrency,
                      date: formatDate(profile.profile.currencyConfirmedAt, locale, viewer.user.timezone),
                    })
                  : t("enterprise.company.currencyUnconfirmed", {
                      currency: company.baseCurrency,
                    })
              }
            />
            <CardBody>
              <CompanyProfileForm
                base={base}
                canManage={canManageCompany}
                currencies={options.currencies}
                countries={options.countries.map((c) => c.code)}
                initial={{
                  name: profile.company.name,
                  legalName: profile.company.legalName ?? "",
                  industry: profile.profile.industry ?? "",
                  website: profile.profile.website ?? "",
                  logoUrl: profile.profile.logoUrl ?? "",
                  description: profile.profile.description ?? "",
                  fiscalYearStartMonth: profile.profile.fiscalYearStartMonth,
                  timezone: profile.company.timezone,
                  baseCurrency: profile.company.baseCurrency,
                  address: {
                    line1: profile.profile.address.line1 ?? "",
                    line2: profile.profile.address.line2 ?? "",
                    city: profile.profile.address.city ?? "",
                    region: profile.profile.address.region ?? "",
                    postalCode: profile.profile.address.postalCode ?? "",
                    countryCode: profile.profile.address.countryCode ?? "",
                  },
                }}
              />
            </CardBody>
          </Card>
          {workspaces ? (
            <Card className="h-fit">
              <CardHeader
                title={t("company.workspaces")}
                description={
                  limits.maxWorkspacesPerCompany !== null
                    ? t("enterprise.company.workspaceLimit", {
                        used: workspaces.length,
                        limit: limits.maxWorkspacesPerCompany,
                      })
                    : undefined
                }
              />
              <CardBody>
                <Workspaces
                  base={base}
                  canManage={canManageWorkspaces}
                  workspaces={workspaces.map((w) => ({
                    id: w.id,
                    name: w.name,
                    projects: w._count.projects,
                  }))}
                />
              </CardBody>
            </Card>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardHeader
          title={org.name}
          description={t("enterprise.company.count", {
            count: companies.length,
          })}
        />
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
                <Th>
                  <span className="sr-only">{t("common.actions")}</span>
                </Th>
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
                  <Td className="text-end">{c.id === company?.id ? <Badge tone="success">{t("enterprise.company.current")}</Badge> : <SwitchCompanyButton companyId={c.id} />}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
