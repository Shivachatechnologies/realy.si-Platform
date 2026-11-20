import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Markdownish } from "@/components/comms/markdownish";
import { PublicShell } from "@/components/support/public-shell";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { publicArticle } from "@/server/modules/support/kb";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("support.help.title") };
}

export default async function HelpArticlePage({ params }: PageProps<"/[locale]/help/[companyId]/[slug]">) {
  const { companyId, slug } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const { company, article } = await publicArticle(companyId, decodeURIComponent(slug)).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const path = `/${locale}/help/${companyId}`;
  return (
    <PublicShell title={t("support.help.heading", { company: company.name })} home={path}>
      <Link href={path} className="text-sm hover:underline">
        ← {t("support.help.allArticles")}
      </Link>
      <Card>
        <CardHeader title={article.title} description={[article.category?.name, t("support.help.updated", { date: formatDate(article.updatedAt, locale, "UTC") })].filter(Boolean).join(" · ")} />
        <CardBody>
          <Markdownish text={article.body} className="text-[15px]" />
        </CardBody>
      </Card>
      {company.supportFormEnabled ? (
        <p className="text-center text-sm">
          {t("support.help.stillNeedHelp")}{" "}
          <Link href={`/${locale}/support-form/${companyId}`} className="underline">
            {t("support.help.contactUs")}
          </Link>
        </p>
      ) : null}
    </PublicShell>
  );
}
