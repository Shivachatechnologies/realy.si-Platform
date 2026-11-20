import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { ArticleForm, KbCategories } from "@/components/support/kb";
import { EmptyState, hrefWith, Pager } from "@/components/comms/bits";
import { areaPage } from "@/components/comms/context";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { listArticles, listKbCategories } from "@/server/modules/support/kb";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("support.kb.title") };
}

export default async function KnowledgePage({ searchParams }: PageProps<"/[locale]/support/knowledge">) {
  const p = await areaPage("support", "knowledge");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, base, perms, wrap } = p;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const q = one("q")?.slice(0, 200);
  const status = one("status") === "DRAFT" || one("status") === "PUBLISHED" ? (one("status") as "DRAFT" | "PUBLISHED") : undefined;
  const categoryId = one("category");
  const page = Math.max(Number(one("page")) || 1, 1);
  const [list, categories] = await Promise.all([listArticles(viewer.ctx, org.id, company.id, { q, status, categoryId, page }), listKbCategories(viewer.ctx, org.id, company.id)]);
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const path = `/${locale}/support/knowledge`;
  return wrap(
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid content-start gap-4">
        {perms.manage ? (
          <Card>
            <details>
              <summary className="cursor-pointer p-4 text-sm font-medium">{t("support.kb.new")}</summary>
              <ArticleForm base={base} locale={locale} categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
            </details>
          </Card>
        ) : null}
        <Card>
          <CardHeader title={t("support.kb.title")} description={t("support.kb.description")} />
          <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_auto]" action={path}>
            <Input name="q" type="search" defaultValue={q ?? ""} maxLength={200} placeholder={t("support.kb.search")} aria-label={t("support.kb.search")} />
            <Select name="status" defaultValue={status ?? ""} aria-label={t("common.status")}>
              <option value="">{t("support.kb.allStatuses")}</option>
              <option value="PUBLISHED">{t("support.kb.statuses.PUBLISHED")}</option>
              <option value="DRAFT">{t("support.kb.statuses.DRAFT")}</option>
            </Select>
            <Select name="category" defaultValue={categoryId ?? ""} aria-label={t("support.kb.category")}>
              <option value="">{t("support.kb.allCategories")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary">
              {t("support.apply")}
            </Button>
          </form>
          {list.data.length === 0 ? (
            <EmptyState>{q || status || categoryId ? t("common.noResults") : t("support.kb.empty")}</EmptyState>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("support.kb.articleTitle")}</Th>
                  <Th className="hidden sm:table-cell">{t("support.kb.category")}</Th>
                  <Th>{t("common.status")}</Th>
                  <Th className="hidden md:table-cell">{t("support.kb.views")}</Th>
                  <Th className="hidden md:table-cell">{t("support.updated")}</Th>
                </Tr>
              </THead>
              <TBody>
                {list.data.map((a) => (
                  <Tr key={a.id}>
                    <Td>
                      <Link href={`${path}/${a.id}`} className="font-medium hover:underline">
                        {a.title}
                      </Link>
                    </Td>
                    <Td className="hidden sm:table-cell">{a.category?.name ?? "—"}</Td>
                    <Td>
                      <Badge tone={a.status === "PUBLISHED" ? "success" : "neutral"}>{t(`support.kb.statuses.${a.status}`)}</Badge>
                    </Td>
                    <Td className="hidden tabular-nums md:table-cell">{a.views}</Td>
                    <Td className="hidden whitespace-nowrap md:table-cell">{formatDate(a.updatedAt, locale, tz)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
          <Pager labels={{ prev: t("common.previous"), next: t("common.next") }} info={t("support.pageInfo", { page, pages, total: list.total })} prevHref={page > 1 ? hrefWith(path, sp, { page: page - 1 }) : null} nextHref={page < pages ? hrefWith(path, sp, { page: page + 1 }) : null} />
        </Card>
      </div>
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader title={t("support.kb.helpCenter")} description={t("support.kb.helpCenterHint")} />
          <CardBody>
            <Link href={`/${locale}/help/${company.id}`} target="_blank" className="flex items-center gap-1 text-sm underline">
              <ExternalLink className="size-3.5" aria-hidden /> {t("support.kb.openHelpCenter")}
            </Link>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("support.kb.categories")} />
          <CardBody>
            <KbCategories base={base} canManage={perms.manage} categories={categories.map((c) => ({ id: c.id, name: c.name, description: c.description, count: c._count.articles }))} />
          </CardBody>
        </Card>
      </div>
    </div>,
  );
}
