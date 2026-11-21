import type { Metadata } from "next";
import Link from "next/link";
import { Eye, FileDown, FileText, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DocGenerator } from "@/components/hr/doc-generator";
import { ActionButton } from "@/components/hr/hr-action";
import { fileSize, peopleOptions } from "@/components/hr/options";
import { HrFrame, loadHr, personName } from "@/components/hr/shell";
import { formatDate } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { oneParam } from "@/server/modules/hr/access";
import { DOC_TEMPLATES, listCompanyDocuments, TEMPLATE_FIELDS } from "@/server/modules/hr/doc-templates";
import { DOCUMENT_CATEGORIES, employeeOptions } from "@/server/modules/hr/employees";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.tabs.documents") };
}

/** HR documents: generate letters from templates and find every stored employee document in one place. */
export default async function HrDocumentsPage({ searchParams }: PageProps<"/[locale]/hr/documents">) {
  const locale = await getLocale();
  const { t, viewer, org, company, access, base, tz } = await loadHr(locale);
  const allowed = !!access?.manage;
  const frame = { t, locale, title: t("hr.documents.title"), subtitle: t("hr.documents.subtitle"), tab: "documents" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const sp = await searchParams;
  const q = oneParam(sp, "q", 100);
  const rawCategory = oneParam(sp, "category", 40);
  const category = (DOCUMENT_CATEGORIES as readonly string[]).includes(rawCategory ?? "") ? rawCategory : undefined;
  const employee = oneParam(sp, "employee", 40);
  const [docs, people] = await Promise.all([listCompanyDocuments(viewer.ctx, org.id, company.id, { q, category }), employeeOptions(viewer.ctx, org.id, company.id)]);
  const total = Object.values(docs.byCategory).reduce((s, n) => s + n, 0);

  return (
    <HrFrame {...frame}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Card variant="highlight">
          <CardHeader icon={<FileText />} title={t("hr.documents.generateTitle")} description={t("hr.documents.generateHint")} />
          <CardBody>
            <DocGenerator
              endpoint={`${base}/hr/documents/generate`}
              viewBase={`${base}/hr/documents`}
              people={peopleOptions(people)}
              templates={DOC_TEMPLATES.map((key) => ({ key, fields: TEMPLATE_FIELDS[key] }))}
              defaultEmployeeId={employee && people.some((p) => p.id === employee) ? employee : undefined}
            />
            <p className="mt-4 text-xs text-muted-foreground">{t("hr.documents.honest")}</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader icon={<FolderOpen />} title={t("hr.documents.libraryTitle")} description={t("hr.documents.libraryHint", { count: total })} />
          <div className="flex flex-wrap gap-1.5 px-3 pb-2">
            <Link href={`/${locale}/hr/documents${q ? `?q=${encodeURIComponent(q)}` : ""}`} aria-current={!category ? "page" : undefined} className={`rounded-full border px-3 py-1 text-xs ${!category ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground hover:bg-muted"}`}>
              {t("hr.documents.all")} · {total}
            </Link>
            {DOCUMENT_CATEGORIES.filter((c) => docs.byCategory[c]).map((c) => (
              <Link key={c} href={`/${locale}/hr/documents?category=${c}${q ? `&q=${encodeURIComponent(q)}` : ""}`} aria-current={category === c ? "page" : undefined} className={`rounded-full border px-3 py-1 text-xs ${category === c ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground hover:bg-muted"}`}>
                {t(`hr.docCategory.${c}`)} · {docs.byCategory[c]}
              </Link>
            ))}
          </div>
          <form action={`/${locale}/hr/documents`} className="flex gap-2 border-y px-3 py-2" role="search">
            {category ? <input type="hidden" name="category" value={category} /> : null}
            <label htmlFor="doc-q" className="sr-only">
              {t("hr.search")}
            </label>
            <Input id="doc-q" name="q" defaultValue={q ?? ""} placeholder={t("hr.documents.searchPlaceholder")} className="min-w-0 flex-1" />
            <Button type="submit" size="sm" variant="secondary">
              {t("hr.apply")}
            </Button>
          </form>
          {docs.rows.length ? (
            <ul className="grid divide-y">
              {docs.rows.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate font-medium">{d.name}</span>
                    <span className="text-xs text-muted-foreground">
                      <Link href={`/${locale}/hr/employees/${d.employee.id}`} className="hover:underline">
                        {personName(d.employee)}
                      </Link>
                      {" · "}
                      {formatDate(d.createdAt, locale, tz)} · {fileSize(d.sizeBytes)}
                    </span>
                  </div>
                  <Badge tone={d.category === "letter" ? "accent" : "neutral"}>{(DOCUMENT_CATEGORIES as readonly string[]).includes(d.category) ? t(`hr.docCategory.${d.category}`) : d.category}</Badge>
                  <span className="flex items-center gap-1">
                    {d.category === "letter" && d.mimeType === "text/html" ? (
                      <a href={`${base}/hr/documents/${d.id}?view=1`} target="_blank" rel="noreferrer" className="grid size-9 place-items-center rounded-md hover:bg-muted" aria-label={t("hr.docgen.open")} title={t("hr.docgen.open")}>
                        <Eye aria-hidden className="size-4" />
                      </a>
                    ) : null}
                    <a href={`${base}/hr/documents/${d.id}`} className="grid size-9 place-items-center rounded-md hover:bg-muted" aria-label={t("hr.download")} title={t("hr.download")}>
                      <FileDown aria-hidden className="size-4" />
                    </a>
                    <ActionButton endpoint={`${base}/hr/documents/${d.id}`} method="DELETE" label={t("hr.delete")} variant="ghost" confirm={t("hr.confirmDelete")} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="grid justify-items-center gap-2 p-8 text-center">
              <FolderOpen aria-hidden className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{q || category ? t("hr.documents.noMatch") : t("hr.documents.empty")}</p>
            </div>
          )}
        </Card>
      </div>
    </HrFrame>
  );
}
