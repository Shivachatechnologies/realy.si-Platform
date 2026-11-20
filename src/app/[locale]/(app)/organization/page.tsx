import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionButton } from "@/components/hr/hr-action";
import { HrForm } from "@/components/hr/hr-form";
import { namedOptions, peopleOptions } from "@/components/hr/options";
import { loadHr, OrgFrame, personName } from "@/components/hr/shell";
import { getLocale, getT } from "@/i18n/server";
import { employeeOptions } from "@/server/modules/hr/employees";
import { listDepartments, listTeams } from "@/server/modules/hr/org";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.organization.title") };
}

type Dept = Awaited<ReturnType<typeof listDepartments>>[number];

export default async function OrganizationPage() {
  const locale = await getLocale();
  const { t, viewer, org, company, access, base } = await loadHr(locale);
  const allowed = !!access?.read;
  if (!company || !allowed) return <OrgFrame t={t} locale={locale} tab="structure" hasCompany={!!company} allowed={allowed}>{null}</OrgFrame>;
  const [departments, teams, people] = await Promise.all([
    listDepartments(viewer.ctx, org.id, company.id),
    listTeams(viewer.ctx, org.id, company.id),
    employeeOptions(viewer.ctx, org.id, company.id),
  ]);
  const manage = access!.manage;
  const deptOptions = namedOptions(departments);
  const personOpts = peopleOptions(people);
  const children = (parentId: string | null) => departments.filter((d) => d.parentId === parentId || (parentId === null && d.parentId && !departments.some((p) => p.id === d.parentId)));
  const deptFields = (d?: Dept) => [
    { name: "name", label: t("hr.org.name"), required: true, maxLength: 120 },
    { name: "costCenterCode", label: t("hr.org.costCenter"), maxLength: 40 },
    { name: "parentId", label: t("hr.org.parent"), type: "select" as const, options: deptOptions.filter((o) => o.value !== d?.id) },
    { name: "headId", label: t("hr.org.head"), type: "select" as const, options: personOpts },
    { name: "description", label: t("hr.org.description"), type: "textarea" as const, rows: 2, maxLength: 1000 },
  ];
  const renderTree = (parentId: string | null, depth: number): ReactNode => {
    const list = children(parentId);
    if (!list.length) return null;
    return (
      <ul className={depth ? "ms-4 grid gap-2 border-s ps-4" : "grid gap-2"}>
        {list.map((d) => (
          <li key={d.id} className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-surface px-3 py-2">
              <Link href={`/${locale}/hr/employees?department=${d.id}`} className="font-medium hover:underline">
                {d.name}
              </Link>
              {d.costCenterCode ? <Badge>{t("hr.org.costCenterShort", { code: d.costCenterCode })}</Badge> : null}
              <span className="text-xs text-muted-foreground">{t("hr.org.peopleCount", { count: d._count.employees })}</span>
              <span className="text-xs text-muted-foreground">{t("hr.org.teamsCount", { count: d._count.teams })}</span>
              {d.head ? (
                <span className="text-xs">
                  {t("hr.org.headLabel")}{" "}
                  <Link href={`/${locale}/hr/employees/${d.head.id}`} className="hover:underline">
                    {personName(d.head)}
                  </Link>
                </span>
              ) : null}
              {manage ? (
                <span className="ms-auto flex items-center gap-2">
                  <details className="relative">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:underline">{t("hr.edit")}</summary>
                    <div className="mt-2 w-[min(32rem,80vw)] rounded-md border bg-surface p-3">
                      <HrForm endpoint={`${base}/hr/departments/${d.id}`} method="PATCH" fields={deptFields(d)} submitLabel={t("common.save")} initial={{ name: d.name, costCenterCode: d.costCenterCode, parentId: d.parentId, headId: d.headId, description: d.description }} />
                    </div>
                  </details>
                  <ActionButton endpoint={`${base}/hr/departments/${d.id}`} method="DELETE" label={t("hr.archive")} variant="ghost" confirm={t("hr.org.archiveDepartmentConfirm")} />
                </span>
              ) : null}
            </div>
            {renderTree(d.id, depth + 1)}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <OrgFrame
      t={t}
      locale={locale}
      tab="structure"
      hasCompany
      allowed
      actions={
        <Link href={`/${locale}/settings/members`} className="text-sm text-primary hover:underline">
          {t("hr.org.platformAccess")}
        </Link>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("hr.org.departments")} description={t("hr.org.departmentsHint")} />
          <CardBody className="grid gap-3">
            {departments.length ? renderTree(null, 0) : <p className="text-sm text-muted-foreground">{t("hr.org.noDepartments")}</p>}
            {manage ? (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">{t("hr.org.addDepartment")}</summary>
                <HrForm className="mt-3" endpoint={`${base}/hr/departments`} fields={deptFields()} submitLabel={t("common.create")} />
              </details>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("hr.org.teams")} description={t("hr.org.teamsHint")} />
          <CardBody className="grid gap-3">
            {teams.length ? (
              <ul className="grid gap-3">
                {teams.map((team) => (
                  <li key={team.id} className="grid gap-2 rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{team.name}</span>
                      {team.department ? <Badge>{team.department.name}</Badge> : null}
                      {team.lead ? (
                        <span className="text-xs">
                          {t("hr.org.leadLabel")}{" "}
                          <Link href={`/${locale}/hr/employees/${team.lead.id}`} className="hover:underline">
                            {personName(team.lead)}
                          </Link>
                        </span>
                      ) : null}
                      <span className="text-xs text-muted-foreground">{t("hr.org.peopleCount", { count: team.members.length })}</span>
                    </div>
                    {team.description ? <p className="text-xs text-muted-foreground">{team.description}</p> : null}
                    <ul className="flex flex-wrap gap-1.5">
                      {team.members.map((m) => (
                        <li key={m.id} className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                          <Link href={`/${locale}/hr/employees/${m.id}`} className="hover:underline">
                            {personName(m)}
                          </Link>
                          {manage ? <ActionButton endpoint={`${base}/hr/teams/${team.id}/members`} body={{ employeeId: m.id, action: "remove" }} label="×" variant="ghost" size="sm" /> : null}
                        </li>
                      ))}
                    </ul>
                    {manage ? (
                      <div className="flex flex-wrap gap-3">
                        <details>
                          <summary className="cursor-pointer text-xs text-muted-foreground hover:underline">{t("hr.org.addMember")}</summary>
                          <HrForm className="mt-2" columns={1} endpoint={`${base}/hr/teams/${team.id}/members`} extra={{ action: "add" }} fields={[{ name: "employeeId", label: t("hr.employee"), type: "select", required: true, options: personOpts }]} submitLabel={t("hr.add")} />
                        </details>
                        <details>
                          <summary className="cursor-pointer text-xs text-muted-foreground hover:underline">{t("hr.edit")}</summary>
                          <HrForm
                            className="mt-2"
                            endpoint={`${base}/hr/teams/${team.id}`}
                            method="PATCH"
                            fields={[
                              { name: "name", label: t("hr.org.name"), required: true },
                              { name: "departmentId", label: t("hr.department"), type: "select", options: deptOptions },
                              { name: "leadId", label: t("hr.org.lead"), type: "select", options: personOpts },
                              { name: "description", label: t("hr.org.description"), type: "textarea", rows: 2 },
                            ]}
                            initial={{ name: team.name, departmentId: team.departmentId, leadId: team.leadId, description: team.description }}
                            submitLabel={t("common.save")}
                          />
                        </details>
                        <ActionButton endpoint={`${base}/hr/teams/${team.id}`} method="DELETE" label={t("hr.archive")} variant="ghost" confirm={t("hr.org.archiveTeamConfirm")} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("hr.org.noTeams")}</p>
            )}
            {manage ? (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">{t("hr.org.addTeam")}</summary>
                <HrForm
                  className="mt-3"
                  endpoint={`${base}/hr/teams`}
                  fields={[
                    { name: "name", label: t("hr.org.name"), required: true, maxLength: 120 },
                    { name: "departmentId", label: t("hr.department"), type: "select", options: deptOptions },
                    { name: "leadId", label: t("hr.org.lead"), type: "select", options: personOpts },
                    { name: "description", label: t("hr.org.description"), type: "textarea", rows: 2 },
                  ]}
                  submitLabel={t("common.create")}
                />
              </details>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </OrgFrame>
  );
}
