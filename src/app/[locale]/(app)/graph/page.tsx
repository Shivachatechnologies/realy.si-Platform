import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { GraphEditor } from "@/components/graph/graph-editor";
import { Card } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { getGraph } from "@/server/modules/graph/service";
import { requireOrgContext } from "@/server/workspace";
import { db } from "@/server/core/db";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("graph.title") };
}

export default async function GraphPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <PageHeader variant="editorial" world="brain" eyebrow={t("dna.worlds.brain")} title={t("graph.title")} description={t("graph.subtitle", { company: company?.name ?? "—" })} />
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
  const [graph, canManage] = await Promise.all([
    getGraph(viewer.ctx, org.id, company.id),
    can(viewer.ctx, "graph.manage", await companyChain(db(), org.id, company.id)),
  ]);
  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <GraphEditor
        organizationId={org.id}
        companyId={company.id}
        canManage={canManage}
        entities={graph.entities.map(({ id, kind, name, description }) => ({ id, kind, name, description }))}
        edges={graph.edges.map(({ id, fromId, relation, toId }) => ({ id, fromId, relation, toId }))}
      />
    </div>
  );
}
