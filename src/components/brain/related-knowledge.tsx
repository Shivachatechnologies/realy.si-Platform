import Link from "next/link";
import { BookOpen } from "lucide-react";
import { LinkDocumentPicker } from "@/components/brain/link-document-picker";
import { Snippet } from "@/components/brain/snippet";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { relatedKnowledge, type LinkSubjectType } from "@/server/modules/brain/links";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

/**
 * "Related knowledge" of a record, embeddable on any record page (server component):
 *   <RelatedKnowledge subjectType="account" subjectId={account.id} />
 * Shows Company Brain documents linked to the record and passages that mention its name; people with brain.manage
 * can link more documents. Renders nothing when the viewer cannot read Company Brain or the record is not in the
 * current company.
 */
export async function RelatedKnowledge({ subjectType, subjectId }: { subjectType: LinkSubjectType; subjectId: string }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  if (!company) return null;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "brain.read", chain), can(viewer.ctx, "brain.manage", chain)]);
  if (!canRead) return null;
  const related = await relatedKnowledge(viewer.ctx, org.id, company.id, subjectType, subjectId).catch((err) => {
    if (isAppError(err) && (err.code === "not_found" || err.code === "forbidden")) return null;
    throw err;
  });
  if (!related) return null;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <BookOpen aria-hidden className="size-4" />
            {t("brain.related.title")}
          </span>
        }
        description={t("brain.related.description", { count: related.linked.length })}
      />
      <CardBody className="grid gap-4">
        {related.linked.length === 0 && related.mentions.length === 0 ? <p className="text-sm text-muted-foreground">{t("brain.related.empty")}</p> : null}
        {related.linked.length ? (
          <ul className="grid gap-1.5" aria-label={t("brain.related.linked")}>
            {related.linked.map((d) => (
              <li key={d.linkId} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                <Link className="min-w-0 truncate font-medium hover:underline" href={`/${locale}/brain/${d.id}`}>
                  {d.title}
                </Link>
                {d.department ? <Badge>{d.department}</Badge> : null}
                {d.sourceType ? <Badge tone="accent">{t(`brain.sources.${d.sourceType}`)}</Badge> : null}
                {d.tags.slice(0, 3).map((tag) => (
                  <Badge key={tag} tone="neutral">
                    #{tag}
                  </Badge>
                ))}
              </li>
            ))}
          </ul>
        ) : null}
        {related.mentions.length ? (
          <section className="grid gap-2" aria-label={t("brain.related.mentions")}>
            <h3 className="text-xs font-medium uppercase text-muted-foreground">{t("brain.related.mentions")}</h3>
            {related.mentions.map((r) => (
              <article key={r.passageId} className="grid gap-1 rounded-md border p-3">
                <Snippet segments={r.snippet} />
                <Link className="text-xs text-muted-foreground hover:underline" href={`/${locale}/brain/${r.citation.documentId}#passage-${r.citation.passage}`}>
                  {r.citation.title} · {t("brain.passage", { n: r.citation.passage })}
                </Link>
              </article>
            ))}
          </section>
        ) : null}
        {canManage ? <LinkDocumentPicker organizationId={org.id} companyId={company.id} subjectType={subjectType} subjectId={subjectId} /> : null}
      </CardBody>
    </Card>
  );
}
