import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { HireDialog } from "@/components/workforce/hire-dialog";
import { PageHeader } from "@/components/workforce/page-header";
import { PageState } from "@/components/workforce/states";
import { WorkforceTabs } from "@/components/workforce/workforce-tabs";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { getTool } from "@/server/modules/tools/registry";
import { listMembers, rolesByDepartment } from "@/server/modules/workforce/service";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("workforce.hire.title") };
}

export default async function HirePage({ searchParams }: PageProps<"/[locale]/workforce/hire">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <>
      <PageHeader title={t("workforce.hire.title")} subtitle={t("workforce.hire.subtitle")} />
      <WorkforceTabs locale={locale} active="hire" labels={{ employees: t("workforce.tabs.employees"), hire: t("workforce.tabs.hire"), usage: t("workforce.tabs.usage"), plans: t("workforce.tabs.plans"), tasks: t("workforce.tabs.tasks") }} />
    </>
  );
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "agents.read", chain), can(viewer.ctx, "agents.manage", chain)]);
  if (!canRead) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;
  const { profile: preselect } = await searchParams;
  const members = canManage ? await listMembers(viewer.ctx, org.id, company.id) : [];
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const toolLabel = (name: string) => {
    const label = t(`workforce.toolNames.${name}`);
    return label === `workforce.toolNames.${name}` ? name.replace(/_/g, " ") : label;
  };

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      {!canManage ? <p className="text-sm text-muted-foreground">{t("workforce.hire.needsManage")}</p> : null}
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
  );
}
