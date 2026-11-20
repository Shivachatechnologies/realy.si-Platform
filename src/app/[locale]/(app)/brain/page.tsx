import type { Metadata } from "next";
import Link from "next/link";
import { AddDocumentForm } from "@/components/brain/add-document-form";
import { BrainTabs } from "@/components/brain/brain-tabs";
import { DocumentTable } from "@/components/brain/document-table";
import { FilterBar } from "@/components/brain/filter-bar";
import { Snippet } from "@/components/brain/snippet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { listDepartments, listDocuments, listTags, searchDocuments, SOURCE_TYPES } from "@/server/modules/brain/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.brain.title") };
}

const str = (v: string | string[] | undefined, max = 200) => (typeof v === "string" ? v.slice(0, max) : undefined);

export default async function BrainPage({ searchParams }: PageProps<"/[locale]/brain">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const sp = await searchParams;
  const q = str(sp.q) ?? "";
  const departmentId = str(sp.departmentId, 36) || undefined;
  const tag = str(sp.tag, 40) || undefined;

  const header = (
    <div className="grid gap-1">
      <h1 className="text-lg font-semibold tracking-tight">{t("modules.brain.title")}</h1>
      <p className="text-muted-foreground">{t("brain.subtitle", { company: company?.name ?? "—" })}</p>
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
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "brain.read", chain), can(viewer.ctx, "brain.manage", chain)]);
  if (!canRead) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </div>
    );
  }

  const [recent, search, departments, tags, bySource] = await Promise.all([
    listDocuments(viewer.ctx, org.id, company.id, { limit: 10 }),
    searchDocuments(viewer.ctx, org.id, company.id, { q, departmentId, tag, limit: 25 }),
    listDepartments(viewer.ctx, org.id, company.id),
    listTags(viewer.ctx, org.id, company.id),
    db().brainDocument.groupBy({ by: ["sourceType"], where: { organizationId: org.id, companyId: company.id }, _count: { _all: true } }),
  ]);
  const counts = new Map(bySource.map((r) => [r.sourceType ?? "upload", r._count._all]));

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <BrainTabs locale={locale} active="search" />
      <Card>
        <CardBody className="grid gap-4">
          <FilterBar action={`/${locale}/brain`} t={t} values={{ q, departmentId, tag }} departments={departments} tags={tags} show={{}} qLabel={t("brain.searchLabel")} />
          {q ? (
            <section aria-label={t("brain.results")} className="grid gap-3">
              <p className="text-sm text-muted-foreground">{t("brain.resultCount", { count: search.results.length, query: q })}</p>
              {search.results.map((r) => (
                <article key={r.passageId} className="grid gap-1.5 rounded-md border p-3">
                  <Snippet segments={r.snippet} />
                  <p className="text-xs text-muted-foreground">
                    {t("brain.source")}{" "}
                    <Link className="font-medium text-foreground hover:underline" href={`/${locale}/brain/${r.citation.documentId}#passage-${r.citation.passage}`}>
                      {r.citation.title} · {t("brain.passage", { n: r.citation.passage })}
                    </Link>
                  </p>
                </article>
              ))}
              {search.results.length === 0 ? (
                <p className="text-sm">
                  <Link className="text-primary hover:underline" href={`/${locale}/brain/ask`}>
                    {t("brain.ask.tryAsking")}
                  </Link>
                </p>
              ) : null}
            </section>
          ) : (
            <p className="text-sm text-muted-foreground">{t("brain.searchHint")}</p>
          )}
        </CardBody>
      </Card>

      <section className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label={t("brain.sourcesTitle")}>
        {(["upload", ...SOURCE_TYPES] as const).map((s) => (
          <Link key={s} href={`/${locale}/documents?source=${s}`} className="grid gap-0.5 rounded-lg border bg-surface p-3 hover:bg-muted">
            <span className="text-xs text-muted-foreground">{t(`brain.sources.${s}`)}</span>
            <span className="tabular text-lg font-semibold">{counts.get(s) ?? 0}</span>
          </Link>
        ))}
      </section>
      <p className="text-xs text-muted-foreground">{t("brain.sourcesHint")}</p>

      {canManage ? <AddDocumentForm organizationId={org.id} companyId={company.id} departments={departments} /> : null}

      <Card>
        <CardHeader
          title={t("brain.recent")}
          actions={
            <Button asChild size="sm" variant="secondary">
              <Link href={`/${locale}/documents`}>{t("brain.allDocuments")}</Link>
            </Button>
          }
        />
        {recent.data.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("brain.empty")}</p>
        ) : (
          <DocumentTable rows={recent.data} t={t} locale={locale} timeZone={viewer.user.timezone} />
        )}
      </Card>
      {tags.length ? (
        <div className="flex flex-wrap gap-1.5" aria-label={t("brain.tags")}>
          {tags.slice(0, 30).map((x) => (
            <Link key={x.tag} href={`/${locale}/documents?tag=${encodeURIComponent(x.tag)}`}>
              <Badge>
                #{x.tag} · {x.count}
              </Badge>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
