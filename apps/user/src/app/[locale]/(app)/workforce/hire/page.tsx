import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { HireDialog } from "@/components/workforce/hire-dialog";
import { JobPicker } from "@/components/workforce/job-picker";
import { profileByKey } from "@/server/modules/agents/profiles";
import { PageHeader } from "@/components/workforce/page-header";
import { PageState } from "@/components/workforce/states";
import { WorkforceTabs } from "@/components/workforce/workforce-tabs";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { getTool, loadTools } from "@/server/modules/tools/registry";
import { DEPARTMENTS, listMembers, rolesByDepartment } from "@/server/modules/workforce/service";
import { assignableTools, listRoles } from "@/server/modules/workforce/roles";
import { ArchiveRoleButton, CustomRoleForm } from "@/components/workforce/custom-role-form";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("workforce.hire.title") };
}

export default async function HirePage({ searchParams }: PageProps<"/[locale]/workforce/hire">) {
  await loadTools();
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <>
      <PageHeader title={t("workforce.hire.title")} subtitle={t("workforce.hire.subtitle")} />
      <WorkforceTabs locale={locale} active="hire" labels={{ employees: t("workforce.tabs.employees"), org: t("workforce.tabs.org"), hire: t("workforce.tabs.hire"), usage: t("workforce.tabs.usage"), plans: t("workforce.tabs.plans"), tasks: t("workforce.tabs.tasks") }} />
    </>
  );
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "agents.read", chain), can(viewer.ctx, "agents.manage", chain)]);
  if (!canRead) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;
  const { profile: preselect } = await searchParams;
  const members = canManage ? await listMembers(viewer.ctx, org.id, company.id) : [];
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const staffed = new Set((await db().aiEmployee.findMany({ where: { organizationId: org.id, companyId: company.id, archivedAt: null }, select: { profileKey: true } })).map((e) => e.profileKey));
  const hasCeo = staffed.has("ai_ceo");
  const jobs = JOBS.filter((j) => profileByKey(j.profileKey)).map((j) => ({ job: j.job, profileKey: j.profileKey, name: t(`profiles.${j.profileKey}.name`), staffed: staffed.has(j.profileKey), recommended: j.profileKey === "ai_ceo" ? !hasCeo : hasCeo && j.recommended }));
  const toolLabel = (name: string) => {
    const label = t(`workforce.toolNames.${name}`);
    return label === `workforce.toolNames.${name}` ? name.replace(/_/g, " ") : label;
  };
  // The company's own roles (B24): defined as data, hired like any built-in role.
  const [customRoles, assignable] = await Promise.all([listRoles(viewer.ctx, org.id, company.id), canManage ? assignableTools() : Promise.resolve([])]);
  const departments = DEPARTMENTS.map((d) => ({ key: d, label: t(`workforce.departments.${d}`) }));

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      {!canManage ? <p className="text-sm text-muted-foreground">{t("workforce.hire.needsManage")}</p> : null}
      {canManage ? (
        <Card variant="highlight">
          <CardHeader title={t("workforce.jobs.question")} description={t("workforce.jobs.hint")} />
          <CardBody>
            <JobPicker apiBase={apiBase} jobs={jobs} />
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("workforce.roles.title")} description={t("workforce.roles.hint")} actions={canManage ? <CustomRoleForm apiBase={apiBase} departments={departments} tools={assignable.map((x) => ({ name: x.name, label: toolLabel(x.name), needsApproval: x.needsApproval }))} /> : null} />
        <CardBody>
          {customRoles.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("workforce.roles.empty")}</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {customRoles.map((r) => {
                const tools = r.tools.flatMap((name) => {
                  const d = getTool(name);
                  return d ? [{ name, label: toolLabel(name), needsApproval: d.autonomy !== "AUTONOMOUS" }] : [];
                });
                return (
                  <Card key={r.id} className="flex flex-col">
                    <CardHeader title={r.name} description={r.description ?? t(`workforce.departments.${r.department}`)} />
                    <CardBody className="grid flex-1 content-start gap-2">
                      <div className="flex flex-wrap gap-1.5">
                        {tools.map((tool) => (
                          <Badge key={tool.name} tone={tool.needsApproval ? "warning" : "neutral"}>
                            {tool.label}
                            {tool.needsApproval ? ` · ${t("workforce.needsApproval")}` : ""}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">{t("workforce.limits", { turns: r.maxTurns })}</p>
                    </CardBody>
                    {canManage ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
                        <HireDialog apiBase={apiBase} profileKey={r.key} roleName={r.name} defaultName={r.name} tools={tools} members={members} defaultOpen={preselect === r.key} />
                        <ArchiveRoleButton apiBase={apiBase} roleId={r.id} name={r.name} />
                      </div>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>
      <details className="grid gap-4">
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground">{t("workforce.jobs.advanced")}</summary>
        <div className="mt-3 grid gap-4">
      {rolesByDepartment().map(({ department, profiles }) => (
        <section key={department} className="grid gap-2" aria-labelledby={`hire-${department}`}>
          <h2 id={`hire-${department}`} className="text-sm font-semibold text-muted-foreground">
            {t(`workforce.departments.${department}`)}
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {profiles.map((p) => {
              const tools = p.tools.flatMap((name) => {
                const d = getTool(name);
                return d ? [{ name, label: toolLabel(name), needsApproval: d.autonomy !== "AUTONOMOUS" }] : [];
              });
              const roleName = t(`profiles.${p.key}.name`);
              return (
                <Card key={p.key} className="flex flex-col">
                  <CardHeader title={roleName} description={t(`profiles.${p.key}.summary`)} />
                  <CardBody className="grid flex-1 content-start gap-2">
                    <span className="text-xs font-medium text-muted-foreground">{t("workforce.tools")}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {tools.map((tool) => (
                        <Badge key={tool.name} tone={tool.needsApproval ? "warning" : "neutral"}>
                          {tool.label}
                          {tool.needsApproval ? ` · ${t("workforce.needsApproval")}` : ""}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">{t("workforce.limits", { turns: p.maxTurns })}</p>
                  </CardBody>
                  {canManage ? (
                    <div className="border-t p-3">
                      <HireDialog apiBase={apiBase} profileKey={p.key} roleName={roleName} defaultName={roleName} tools={tools} members={members} defaultOpen={preselect === p.key} />
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </section>
      ))}
        </div>
      </details>
    </div>
  );
}

/** Plain-language jobs → the role that does them. */
const JOBS: { job: string; profileKey: string; recommended?: boolean }[] = [
  { job: "runCompany", profileKey: "ai_ceo" },
  { job: "findCustomers", profileKey: "sales_manager", recommended: true },
  { job: "marketing", profileKey: "cmo", recommended: true },
  { job: "money", profileKey: "ai_cfo" },
  { job: "answerCustomers", profileKey: "support_agent" },
  { job: "projects", profileKey: "ai_project_manager" },
  { job: "people", profileKey: "people_analyst" },
  { job: "research", profileKey: "research_analyst" },
];
