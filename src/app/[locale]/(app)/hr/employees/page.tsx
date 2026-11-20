import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { CsvImport } from "@/components/hr/csv-import";
import { HrForm } from "@/components/hr/hr-form";
import { enumOptions, namedOptions, peopleOptions, STATUS_TONE } from "@/components/hr/options";
import { HrFrame, loadHr, Pager, personName } from "@/components/hr/shell";
import { formatDate } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { CSV_HEADER, EMPLOYEE_SORTS, EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, employeeOptions, listDesignations, listEmployees, parseEmployeeFilters } from "@/server/modules/hr/employees";
import { listDepartments, listTeams } from "@/server/modules/hr/org";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.tabs.employees") };
}

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const { t, viewer, org, company, access, base } = await loadHr(locale);
  const allowed = !!access?.read;
  const frame = { t, locale, title: t("hr.employees.title"), subtitle: t("hr.employees.subtitle"), tab: "employees" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const raw = await searchParams;
  const filters = parseEmployeeFilters({ status: "CURRENT", ...raw });
  const [list, departments, teams, people, designations] = await Promise.all([
    listEmployees(viewer.ctx, org.id, company.id, filters),
    listDepartments(viewer.ctx, org.id, company.id),
    listTeams(viewer.ctx, org.id, company.id),
    access!.manage ? employeeOptions(viewer.ctx, org.id, company.id) : Promise.resolve([]),
    access!.manage ? listDesignations(viewer.ctx, org.id, company.id) : Promise.resolve([]),
  ]);
  const manage = access!.manage;
  const params = { q: filters.q, department: filters.department, team: filters.team, status: filters.status, type: filters.type, sort: filters.sort, dir: filters.dir };
  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  const sortLink = (key: (typeof EMPLOYEE_SORTS)[number]) => {
    const q = new URLSearchParams(Object.entries({ ...params, sort: key, dir: filters.sort === key && filters.dir === "asc" ? "desc" : "asc" }).filter((e): e is [string, string] => !!e[1]));
    return `/${locale}/hr/employees?${q}`;
  };
  const arrow = (key: string) => (filters.sort === key ? (filters.dir === "asc" ? " ↑" : " ↓") : "");
  const filtered = !!(filters.q || filters.department || filters.team || filters.type || filters.status !== "CURRENT");
  return (
    <HrFrame
      {...frame}
      actions={
        manage ? (
          <Button asChild variant="secondary" size="sm">
            <a href={`${base}/hr/employees/export?${qs}`}>
              <Download aria-hidden />
              {t("hr.employees.export")}
            </a>
          </Button>
        ) : null
      }
    >
      <Card>
        <CardHeader title={t("hr.employees.directory")} description={t("hr.employees.count", { count: list.total })} actions={<Link href={`/${locale}/organization/chart`} className="text-xs text-primary hover:underline">{t("hr.org.tabs.chart")}</Link>} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_10rem_10rem_9rem_9rem_auto]" action={`/${locale}/hr/employees`}>
          <Input name="q" type="search" defaultValue={filters.q ?? ""} maxLength={200} aria-label={t("hr.search")} placeholder={t("hr.employees.searchPlaceholder")} />
          <Select name="department" defaultValue={filters.department ?? ""} aria-label={t("hr.department")}>
            <option value="">{t("hr.allDepartments")}</option>
            <option value="none">{t("hr.noDepartment")}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select name="team" defaultValue={filters.team ?? ""} aria-label={t("hr.team")}>
            <option value="">{t("hr.allTeams")}</option>
            <option value="none">{t("hr.noTeam")}</option>
            {teams.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select name="status" defaultValue={filters.status ?? ""} aria-label={t("common.status")}>
            <option value="CURRENT">{t("hr.employees.current")}</option>
            <option value="">{t("common.all")}</option>
            {EMPLOYEE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`hr.status.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="type" defaultValue={filters.type ?? ""} aria-label={t("hr.employmentTypeLabel")}>
            <option value="">{t("hr.allTypes")}</option>
            {EMPLOYMENT_TYPES.map((s) => (
              <option key={s} value={s}>
                {t(`hr.employmentType.${s}`)}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            <input type="hidden" name="sort" value={filters.sort} />
            <input type="hidden" name="dir" value={filters.dir} />
            <Button type="submit" variant="secondary">
              {t("hr.apply")}
            </Button>
            {filtered ? (
              <Link href={`/${locale}/hr/employees`} className="self-center text-xs text-muted-foreground hover:underline">
                {t("hr.clear")}
              </Link>
            ) : null}
          </div>
        </form>
        {manage ? (
          <>
            <details className="border-b">
              <summary className="cursor-pointer p-3 text-sm font-medium">{t("hr.employees.add")}</summary>
              <HrForm
                className="px-3 pb-3"
                columns={3}
                endpoint={`${base}/hr/employees`}
                redirectTo="/hr/employees/:id"
                fields={[
                  { name: "firstName", label: t("hr.firstName"), required: true, maxLength: 100 },
                  { name: "lastName", label: t("hr.lastName"), maxLength: 100 },
                  { name: "email", label: t("hr.workEmail"), type: "email" },
                  { name: "phone", label: t("hr.phone"), type: "tel" },
                  { name: "employeeNumber", label: t("hr.employeeNumber"), maxLength: 40 },
                  { name: "designationId", label: t("hr.designation"), type: "select", options: namedOptions(designations), hint: t("hr.employees.designationHint") },
                  { name: "title", label: t("hr.jobTitle"), maxLength: 120 },
                  { name: "departmentId", label: t("hr.department"), type: "select", options: namedOptions(departments) },
                  { name: "teamId", label: t("hr.team"), type: "select", options: namedOptions(teams) },
                  { name: "managerId", label: t("hr.manager"), type: "select", options: peopleOptions(people) },
                  { name: "employmentType", label: t("hr.employmentTypeLabel"), type: "select", required: true, options: enumOptions(t, "hr.employmentType", EMPLOYMENT_TYPES) },
                  { name: "status", label: t("common.status"), type: "select", required: true, options: enumOptions(t, "hr.status", ["ACTIVE", "ONBOARDING"]) },
                  { name: "startDate", label: t("hr.startDate"), type: "date" },
                  { name: "location", label: t("hr.location"), maxLength: 120 },
                  { name: "skills", label: t("hr.skills"), type: "tags", hint: t("hr.tagsHint") },
                  { name: "startOnboarding", label: t("hr.employees.startOnboarding"), type: "checkbox", hint: t("hr.employees.startOnboardingHint") },
                ]}
                initial={{ employmentType: "FULL_TIME", status: "ACTIVE", startOnboarding: true }}
                submitLabel={t("hr.employees.create")}
              />
            </details>
            <details className="border-b">
              <summary className="cursor-pointer p-3 text-sm font-medium">{t("hr.employees.importTitle")}</summary>
              <CsvImport endpoint={`${base}/hr/employees/import`} columns={CSV_HEADER} />
            </details>
          </>
        ) : null}
        {list.rows.length === 0 ? (
          <p className="p-4 text-muted-foreground">{filtered ? t("common.noResults") : t("hr.employees.empty")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>
                  <Link href={sortLink("name")} className="hover:underline">
                    {t("hr.name")}
                    {arrow("name")}
                  </Link>
                </Th>
                <Th>
                  <Link href={sortLink("title")} className="hover:underline">
                    {t("hr.jobTitle")}
                    {arrow("title")}
                  </Link>
                </Th>
                <Th>
                  <Link href={sortLink("department")} className="hover:underline">
                    {t("hr.department")}
                    {arrow("department")}
                  </Link>
                </Th>
                <Th className="hidden md:table-cell">{t("hr.team")}</Th>
                <Th className="hidden md:table-cell">{t("hr.manager")}</Th>
                <Th>
                  <Link href={sortLink("status")} className="hover:underline">
                    {t("common.status")}
                    {arrow("status")}
                  </Link>
                </Th>
                <Th className="hidden lg:table-cell">
                  <Link href={sortLink("start")} className="hover:underline">
                    {t("hr.startDate")}
                    {arrow("start")}
                  </Link>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {list.rows.map((e) => (
                <Tr key={e.id}>
                  <Td>
                    <Link href={`/${locale}/hr/employees/${e.id}`} className="font-medium hover:underline">
                      {personName(e)}
                    </Link>
                    <div className="text-xs text-muted-foreground">{e.email ?? ""}</div>
                  </Td>
                  <Td>{e.title ?? "—"}</Td>
                  <Td>{e.department?.name ?? "—"}</Td>
                  <Td className="hidden md:table-cell">{e.team?.name ?? "—"}</Td>
                  <Td className="hidden md:table-cell">{e.manager ? personName(e.manager) : "—"}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[e.status]}>{t(`hr.status.${e.status}`)}</Badge>
                    <div className="text-[11px] text-muted-foreground">{t(`hr.employmentType.${e.employmentType}`)}</div>
                  </Td>
                  <Td className="hidden lg:table-cell">{e.startDate ? formatDate(e.startDate, locale, "UTC") : "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <Pager locale={locale} path="/hr/employees" params={params} page={list.page} pages={list.pages} t={t} />
      </Card>
      {manage ? (
        <p className="text-xs text-muted-foreground">
          <Link href={`/${locale}/organization/roles#designations`} className="text-primary hover:underline">
            {t("hr.org.designations")}
          </Link>
        </p>
      ) : null}
    </HrFrame>
  );
}
