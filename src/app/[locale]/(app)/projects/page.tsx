import type { Metadata } from "next";
import { NewProjectForm } from "@/components/company/new-project-form";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { db } from "@/server/core/db";
import { listProjects, listWorkspaces } from "@/server/modules/companies/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.projects.title") };
}

export default async function ProjectsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <div className="grid gap-1">
      <h1 className="text-lg font-semibold tracking-tight">{t("modules.projects.title")}</h1>
      <p className="text-muted-foreground">{t("modules.projects.description")}</p>
    </div>
  );
  if (!company) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Card>
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        </Card>
      </div>
    );
  }
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "projects.read", chain), can(viewer.ctx, "projects.manage", chain)]);
  if (!canRead) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </div>
    );
  }
  const [projects, workspaces] = await Promise.all([listProjects(viewer.ctx, org.id, company.id), listWorkspaces(viewer.ctx, org.id, company.id)]);
  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <Card>
        <CardHeader title={company.name} description={t("projects.count", { count: projects.length })} />
        {canManage && workspaces.length ? <NewProjectForm organizationId={org.id} workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))} /> : null}
        {projects.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("projects.empty")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("projects.name")}</Th>
                <Th>{t("projects.workspace")}</Th>
                <Th>{t("projects.created")}</Th>
              </Tr>
            </THead>
            <TBody>
              {projects.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-medium">{p.name}</Td>
                  <Td>{p.workspace.name}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{formatDate(p.createdAt, locale, viewer.user.timezone)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
