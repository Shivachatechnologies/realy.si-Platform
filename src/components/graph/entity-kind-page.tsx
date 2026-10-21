import Link from "next/link";
import { Network } from "lucide-react";
import type { GraphEntityKind } from "@/generated/prisma/enums";
import { AddEntityForm } from "@/components/graph/add-entity-form";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { getGraph } from "@/server/modules/graph/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

/**
 * People, Products and Customers: one Company Graph entity kind as a list, with its relations. Same data, API and
 * permissions as the Company Graph page — not a separate store.
 */
export async function EntityKindPage({ module, kinds }: { module: "people" | "products" | "customers"; kinds: GraphEntityKind[] }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <div className="flex items-start justify-between gap-4">
      <div className="grid gap-1">
        <h1 className="text-lg font-semibold tracking-tight">{t(`modules.${module}.title`)}</h1>
        <p className="text-muted-foreground">{t(`modules.${module}.description`)}</p>
      </div>
      <Button asChild size="sm" variant="secondary">
        <Link href={`/${locale}/graph`}>
          <Network aria-hidden />
          {t("graph.title")}
        </Link>
      </Button>
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
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "graph.read", chain), can(viewer.ctx, "graph.manage", chain)]);
  if (!canRead) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </div>
    );
  }
  const graph = await getGraph(viewer.ctx, org.id, company.id);
  const names = new Map(graph.entities.map((e) => [e.id, e.name]));
  const rows = graph.entities.filter((e) => kinds.includes(e.kind));

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      {kinds.map((kind) => {
        const list = rows.filter((e) => e.kind === kind);
        return (
          <Card key={kind}>
            <CardHeader title={t(`graph.kinds.${kind}`)} description={t("graph.kindCount", { count: list.length })} />
            {canManage ? <AddEntityForm organizationId={org.id} companyId={company.id} kind={kind} /> : null}
            {list.length === 0 ? (
              <p className="p-4 text-muted-foreground">{t("graph.emptyKind")}</p>
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>{t("graph.name")}</Th>
                    <Th>{t("graph.description")}</Th>
                    <Th>{t("graph.relations")}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {list.map((e) => {
                    const rels = graph.edges.filter((x) => x.fromId === e.id || x.toId === e.id);
                    return (
                      <Tr key={e.id}>
                        <Td className="font-medium">{e.name}</Td>
                        <Td className="max-w-md text-muted-foreground">{e.description ?? "—"}</Td>
                        <Td className="text-sm">
                          {rels.length === 0
                            ? "—"
                            : rels.map((x) => (
                                <div key={x.id}>
                                  {x.fromId === e.id
                                    ? `${t(`graph.relationLabels.${x.relation}`)} ${names.get(x.toId)}`
                                    : `${names.get(x.fromId)} ${t(`graph.relationLabels.${x.relation}`)}`}
                                </div>
                              ))}
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </Card>
        );
      })}
    </div>
  );
}
