import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import Link from "next/link";
import { BrainTabs } from "@/components/brain/brain-tabs";
import { DocumentTable } from "@/components/brain/document-table";
import { FilterBar } from "@/components/brain/filter-bar";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { listDepartments, listDocuments, listTags } from "@/server/modules/brain/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.documents.title") };
}

const PAGE = 50;

/** The Company Brain document library: every document (uploaded or indexed from a module), filterable and paged. */
export default async function DocumentsPage({ searchParams }: PageProps<"/[locale]/documents">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const sp = await searchParams;
  const values = Object.fromEntries(["q", "departmentId", "tag", "source", "sort", "cursor"].map((k) => [k, typeof sp[k] === "string" ? (sp[k] as string).slice(0, 200) : undefined])) as Record<string, string | undefined>;

  const header = (
    <PageHeader variant="editorial" world="brain" eyebrow={t("dna.worlds.brain")} title={t("modules.documents.title")} description={t("modules.documents.description")} />
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
  if (!(await can(viewer.ctx, "brain.read", await companyChain(db(), org.id, company.id)))) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </div>
    );
  }
  const cursor = values.cursor && /^[0-9a-f-]{36}$/i.test(values.cursor) ? values.cursor : undefined;
  const [page, departments, tags] = await Promise.all([
    listDocuments(viewer.ctx, org.id, company.id, { ...values, cursor, limit: PAGE }),
    listDepartments(viewer.ctx, org.id, company.id),
    listTags(viewer.ctx, org.id, company.id),
  ]);
  const filtered = Boolean(values.q || values.departmentId || values.tag || values.source);
  const next = page.nextCursor ? `/${locale}/documents?${new URLSearchParams({ ...Object.fromEntries(Object.entries(values).filter(([k, v]) => v && k !== "cursor")), cursor: page.nextCursor } as Record<string, string>)}` : null;

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <BrainTabs locale={locale} active="documents" />
      <Card>
        <div className="border-b p-4">
          <FilterBar action={`/${locale}/documents`} t={t} values={values} departments={departments} tags={tags} show={{ source: true, sort: true }} qLabel={t("brain.filters.titleSearch")} />
        </div>
        <CardHeader title={t("brain.documents")} description={t("brain.documentCount", { count: page.data.length })} />
        {page.data.length === 0 ? (
          <p className="p-4 text-muted-foreground">{filtered ? t("brain.noMatches") : t("brain.empty")}</p>
        ) : (
          <DocumentTable rows={page.data} t={t} locale={locale} timeZone={viewer.user.timezone} />
        )}
        <div className="flex justify-between gap-2 border-t p-3">
          {cursor ? (
            <Button asChild size="sm" variant="ghost">
              <Link href={`/${locale}/documents?${new URLSearchParams(Object.fromEntries(Object.entries(values).filter(([k, v]) => v && k !== "cursor")) as Record<string, string>)}`}>{t("brain.firstPage")}</Link>
            </Button>
          ) : (
            <span />
          )}
          {next ? (
            <Button asChild size="sm" variant="secondary">
              <Link href={next}>{t("brain.nextPage")}</Link>
            </Button>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
