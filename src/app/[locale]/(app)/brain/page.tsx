import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { AddDocumentForm } from "@/components/brain/add-document-form";
import { Snippet } from "@/components/brain/snippet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { db } from "@/server/core/db";
import { listDocuments, searchDocuments } from "@/server/modules/brain/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.brain.title") };
}

export default async function BrainPage({ searchParams }: PageProps<"/[locale]/brain">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const q = typeof (await searchParams).q === "string" ? ((await searchParams).q as string).slice(0, 200) : "";

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

  const [documents, search, canManage] = await Promise.all([
    listDocuments(viewer.ctx, org.id, company.id, { limit: 100 }),
    searchDocuments(viewer.ctx, org.id, company.id, { q }),
    can(viewer.ctx, "brain.manage", await companyChain(db(), org.id, company.id)),
  ]);

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <Card>
        <CardBody className="grid gap-4">
          <form role="search" className="flex gap-2" action={`/${locale}/brain`}>
            <Input name="q" type="search" defaultValue={q} maxLength={200} aria-label={t("brain.searchLabel")} placeholder={t("brain.searchPlaceholder")} />
            <Button type="submit">
              <Search aria-hidden />
              {t("brain.search")}
            </Button>
          </form>
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
            </section>
          ) : null}
        </CardBody>
      </Card>

      {canManage ? <AddDocumentForm organizationId={org.id} companyId={company.id} /> : null}

      <Card>
        <CardHeader title={t("brain.documents")} description={t("brain.documentCount", { count: documents.data.length })} />
        {documents.data.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("brain.empty")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("brain.columns.title")}</Th>
                <Th>{t("brain.columns.type")}</Th>
                <Th>{t("brain.columns.passages")}</Th>
                <Th>{t("brain.columns.status")}</Th>
                <Th>{t("brain.columns.added")}</Th>
              </Tr>
            </THead>
            <TBody>
              {documents.data.map((d) => (
                <Tr key={d.id}>
                  <Td className="font-medium">
                    <Link className="hover:underline" href={`/${locale}/brain/${d.id}`}>
                      {d.title}
                    </Link>
                    {d.filename ? <div className="text-xs font-normal text-muted-foreground">{d.filename}</div> : null}
                  </Td>
                  <Td className="font-mono text-xs">{d.mimeType}</Td>
                  <Td className="tabular">{d.passages}</Td>
                  <Td>
                    <Badge tone={d.status === "READY" ? "success" : d.status === "FAILED" ? "danger" : "warning"}>{t(`brain.status.${d.status}`)}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{formatDate(d.createdAt, locale, viewer.user.timezone)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
