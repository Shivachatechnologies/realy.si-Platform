import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { ActionButton } from "@/components/hr/hr-action";
import { HrForm } from "@/components/hr/hr-form";
import { loadHr, OrgFrame, personName, Stat } from "@/components/hr/shell";
import { getLocale, getT } from "@/i18n/server";
import { listDesignations } from "@/server/modules/hr/employees";
import { rolesOverview } from "@/server/modules/hr/org";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.org.tabs.roles") };
}

export default async function RolesPage() {
  const locale = await getLocale();
  const { t, viewer, org, company, access, base } = await loadHr(locale);
  const allowed = !!access?.read;
  if (!company || !allowed) return <OrgFrame t={t} locale={locale} tab="roles" hasCompany={!!company} allowed={allowed}>{null}</OrgFrame>;
  const [overview, designations] = await Promise.all([rolesOverview(viewer.ctx, org.id, company.id), listDesignations(viewer.ctx, org.id, company.id)]);
  const manage = access!.manage;
  const avgSpan = overview.managers.length ? (overview.managers.reduce((n, m) => n + m.reports, 0) / overview.managers.length).toFixed(1) : "—";
  return (
    <OrgFrame t={t} locale={locale} tab="roles" hasCompany allowed>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t("hr.metrics.headcount")} value={overview.total} />
        <Stat label={t("hr.org.managers")} value={overview.managers.length} />
        <Stat label={t("hr.org.avgSpan")} value={avgSpan} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card id="designations">
          <CardHeader title={t("hr.org.designations")} description={t("hr.org.designationsHint")} />
          <CardBody className="grid gap-3">
            {designations.length ? (
              <ul className="grid divide-y rounded-md border">
                {designations.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <span className="font-medium">{d.name}</span>
                    {d.level ? <Badge>{d.level}</Badge> : null}
                    <span className="text-xs text-muted-foreground">{t("hr.org.peopleCount", { count: d._count.employees })}</span>
                    {manage ? (
                      <span className="ms-auto flex items-center gap-2">
                        <details>
                          <summary className="cursor-pointer text-xs text-muted-foreground hover:underline">{t("hr.edit")}</summary>
                          <HrForm
                            className="mt-2"
                            endpoint={`${base}/hr/designations/${d.id}`}
                            method="PATCH"
                            fields={[
                              { name: "name", label: t("hr.org.name"), required: true },
                              { name: "level", label: t("hr.org.level") },
                              { name: "description", label: t("hr.org.description"), type: "textarea", rows: 2 },
                            ]}
                            initial={{ name: d.name, level: d.level, description: d.description }}
                            submitLabel={t("common.save")}
                          />
                        </details>
                        <ActionButton endpoint={`${base}/hr/designations/${d.id}`} method="DELETE" label={t("hr.archive")} variant="ghost" confirm={t("hr.confirmArchive")} />
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("hr.org.noDesignations")}</p>
            )}
            {manage ? (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">{t("hr.org.addDesignation")}</summary>
                <HrForm
                  className="mt-3"
                  endpoint={`${base}/hr/designations`}
                  fields={[
                    { name: "name", label: t("hr.org.name"), required: true, maxLength: 120 },
                    { name: "level", label: t("hr.org.level"), maxLength: 40 },
                    { name: "description", label: t("hr.org.description"), type: "textarea", rows: 2 },
                  ]}
                  submitLabel={t("common.create")}
                />
              </details>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("hr.org.titles")} description={t("hr.org.titlesHint")} />
          <Table>
            <THead>
              <Tr>
                <Th>{t("hr.jobTitle")}</Th>
                <Th className="text-end">{t("hr.org.people")}</Th>
              </Tr>
            </THead>
            <TBody>
              {overview.titles.map((r) => (
                <Tr key={r.title ?? "none"}>
                  <Td>{r.title ?? <span className="text-muted-foreground">{t("hr.org.noTitle")}</span>}</Td>
                  <Td className="text-end">{r.count}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader title={t("hr.org.reportingStructure")} description={t("hr.org.reportingHint")} />
          <Table>
            <THead>
              <Tr>
                <Th>{t("hr.manager")}</Th>
                <Th className="text-end">{t("hr.org.directReports")}</Th>
              </Tr>
            </THead>
            <TBody>
              {overview.managers.map((m) => (
                <Tr key={m.id}>
                  <Td>
                    <Link href={`/${locale}/hr/employees/${m.id}`} className="hover:underline">
                      {personName(m)}
                    </Link>
                    {m.title ? <span className="ms-2 text-xs text-muted-foreground">{m.title}</span> : null}
                  </Td>
                  <Td className="text-end">
                    {m.reports > 8 ? <Badge tone="warning">{m.reports}</Badge> : m.reports}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          {!overview.managers.length ? <p className="p-4 text-sm text-muted-foreground">{t("hr.org.noManagers")}</p> : null}
        </Card>
        <Card>
          <CardHeader title={t("hr.org.leadership")} />
          <CardBody className="grid gap-3 text-sm">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{t("hr.org.departmentHeads")}</p>
              <ul className="grid gap-1">
                {overview.heads.map((d) => (
                  <li key={d.id} className="flex justify-between gap-2">
                    <span>{d.name}</span>
                    {d.head ? (
                      <Link href={`/${locale}/hr/employees/${d.head.id}`} className="hover:underline">
                        {personName(d.head)}
                      </Link>
                    ) : (
                      <Badge tone="warning">{t("hr.org.vacant")}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{t("hr.org.teamLeads")}</p>
              <ul className="grid gap-1">
                {overview.leads.map((d) => (
                  <li key={d.id} className="flex justify-between gap-2">
                    <span>{d.name}</span>
                    {d.lead ? (
                      <Link href={`/${locale}/hr/employees/${d.lead.id}`} className="hover:underline">
                        {personName(d.lead)}
                      </Link>
                    ) : (
                      <Badge tone="warning">{t("hr.org.vacant")}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("hr.org.platformRolesHint")}{" "}
              <Link href={`/${locale}/settings/members`} className="text-primary hover:underline">
                {t("hr.org.platformAccess")}
              </Link>
            </p>
          </CardBody>
        </Card>
      </div>
    </OrgFrame>
  );
}
