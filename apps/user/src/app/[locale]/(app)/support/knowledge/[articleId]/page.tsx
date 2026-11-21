import type { Metadata } from "next";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { introLabels } from "@/components/guide-kit/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionButton } from "@/components/comms/client";
import { areaPage } from "@/components/comms/context";
import { Markdownish } from "@/components/comms/markdownish";
import { ArticleForm } from "@/components/support/kb";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { getArticle, listKbCategories } from "@/server/modules/support/kb";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("support.kb.title") };
}

export default async function ArticlePage({ params }: PageProps<"/[locale]/support/knowledge/[articleId]">) {
  const { articleId } = await params;
  const p = await areaPage("support", "knowledge");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, base, perms, wrap } = p;
  const a = await getArticle(viewer.ctx, org.id, company.id, articleId).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const categories = await listKbCategories(viewer.ctx, org.id, company.id);
  const path = `${base}/support/kb/articles/${a.id}`;
  return wrap(
    <>
    <PageIntro labels={introLabels(t)} what={t("support.intro.article.what")} why={t("support.intro.article.why")} can={t("support.intro.article.can")} accent="warning" />
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader title={a.title} description={`${a.category?.name ?? t("support.kb.uncategorized")} · ${t("support.kb.viewsCount", { count: a.views })} · ${formatDateTime(a.updatedAt, locale, tz)}`} actions={<Badge tone={a.status === "PUBLISHED" ? "success" : "neutral"}>{t(`support.kb.statuses.${a.status}`)}</Badge>} />
          <CardBody>
            <Markdownish text={a.body} />
          </CardBody>
        </Card>
        {perms.manage ? (
          <Card>
            <details>
              <summary className="cursor-pointer p-4 text-sm font-medium">{t("communication.edit")}</summary>
              <ArticleForm base={base} locale={locale} categories={categories.map((c) => ({ id: c.id, name: c.name }))} initial={{ id: a.id, title: a.title, body: a.body, categoryId: a.categoryId, status: a.status, tags: a.tags }} />
            </details>
          </Card>
        ) : null}
      </div>
      <div className="grid content-start gap-3">
        {perms.manage ? (
          <Card>
            <CardBody className="flex flex-wrap gap-2">
              <ActionButton path={path} method="PATCH" body={{ status: a.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED" }} variant={a.status === "PUBLISHED" ? "secondary" : "default"}>
                {a.status === "PUBLISHED" ? t("support.kb.unpublish") : t("support.kb.publish")}
              </ActionButton>
              <ActionButton path={path} method="DELETE" variant="danger" confirm={t("communication.confirmDelete")} redirectTo={`/${locale}/support/knowledge`}>
                {t("communication.delete")}
              </ActionButton>
            </CardBody>
          </Card>
        ) : null}
        {a.status === "PUBLISHED" ? (
          <Link href={`/${locale}/help/${company.id}/${a.slug}`} target="_blank" className="text-sm underline">
            {t("support.kb.viewPublic")}
          </Link>
        ) : null}
        {a.tags.length ? <p className="text-xs text-muted-foreground">{a.tags.map((x) => `#${x}`).join(" ")}</p> : null}
        <Link href={`/${locale}/support/knowledge`} className="text-sm hover:underline">
          ← {t("support.kb.back")}
        </Link>
      </div>
    </div>
    </>,
  );
}
