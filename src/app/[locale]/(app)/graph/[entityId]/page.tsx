import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { RelatedKnowledge } from "@/components/brain/related-knowledge";
import { EntityEditForm } from "@/components/graph/entity-edit-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { getEntity } from "@/server/modules/graph/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("graph.title") };
}

export default async function GraphEntityPage({ params }: PageProps<"/[locale]/graph/[entityId]">) {
  const { entityId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  if (!company) notFound();
  const entity = await getEntity(viewer.ctx, org.id, company.id, entityId).catch((err) => {
    if (isAppError(err) && (err.code === "not_found" || err.code === "forbidden")) notFound();
    throw err;
  });
  const canManage = await can(viewer.ctx, "graph.manage", await companyChain(db(), org.id, company.id));
  const relations = [
    ...entity.outgoing.map((e) => ({ id: e.id, relation: e.relation, other: e.to, outgoing: true })),
    ...entity.incoming.map((e) => ({ id: e.id, relation: e.relation, other: e.from, outgoing: false })),
  ];

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <Link href={`/${locale}/graph`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
        {t("graph.title")}
      </Link>
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              {entity.name}
              <Badge>{t(`graph.kinds.${entity.kind}`)}</Badge>
            </span>
          }
          description={t("graph.since", { date: formatDate(entity.createdAt, locale, viewer.user.timezone) })}
        />
        <CardBody>
          {canManage ? (
            <EntityEditForm organizationId={org.id} companyId={company.id} entity={{ id: entity.id, name: entity.name, description: entity.description }} />
          ) : (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{entity.description ?? "—"}</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("graph.relations")} description={t("graph.counts", { entities: 1, relations: relations.length })} />
        <CardBody>
          {relations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("graph.noRelations")}</p>
          ) : (
            <ul className="grid gap-1.5">
              {relations.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                  <span className={r.outgoing ? "font-medium" : ""}>{r.outgoing ? entity.name : r.other.name}</span>
                  <ArrowRight aria-hidden className="size-3.5 text-muted-foreground rtl:rotate-180" />
                  <Badge tone="neutral">{t(`graph.relationLabels.${r.relation}`)}</Badge>
                  <ArrowRight aria-hidden className="size-3.5 text-muted-foreground rtl:rotate-180" />
                  {r.outgoing ? (
                    <Link className="hover:underline" href={`/${locale}/graph/${r.other.id}`}>
                      {r.other.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{entity.name}</span>
                  )}
                  {!r.outgoing ? (
                    <Link className="ms-auto text-xs text-muted-foreground hover:underline" href={`/${locale}/graph/${r.other.id}`}>
                      {t("graph.open", { name: r.other.name })}
                    </Link>
                  ) : (
                    <span className="ms-auto text-xs text-muted-foreground">{t(`graph.kinds.${r.other.kind}`)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <RelatedKnowledge subjectType="graph_entity" subjectId={entity.id} />
    </div>
  );
}
