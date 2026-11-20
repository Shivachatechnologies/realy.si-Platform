import type { Metadata } from "next";
import { closestLocale } from "@/i18n/config";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { publicBlogPost } from "@/server/modules/marketing/blog";
import { bodyToHtml } from "@/server/modules/marketing/providers/cms";
import { db } from "@/server/core/db";

export async function generateMetadata({ params }: PageProps<"/[locale]/blog/[companyId]/[slug]">): Promise<Metadata> {
  const { companyId, slug } = await params;
  const p = await db().marketingContent.findFirst({ where: { companyId, slug, blogPublic: true, status: "PUBLISHED" }, select: { title: true, metaTitle: true, metaDescription: true, keywords: true } });
  return p ? { title: p.metaTitle ?? p.title, description: p.metaDescription ?? undefined, keywords: p.keywords } : { title: "Blog" };
}

export default async function PublicBlogPost({ params }: PageProps<"/[locale]/blog/[companyId]/[slug]">) {
  const { locale, companyId, slug } = await params;
  const p = await publicBlogPost(companyId, slug);
  if (!p) notFound();
  const t = await getT(closestLocale(locale));
  // Body HTML is generated from our own Markdown subset (escaped); JSON-LD is serialized server data.
  const html = bodyToHtml(p.body);
  const ld = p.schemaMarkup ? JSON.stringify(p.schemaMarkup).replace(/</g, "\\u003c") : null;
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-10">
      <Link href={`/${locale}/blog/${companyId}`} className="text-sm text-muted-foreground hover:underline">
        {t("marketing.studio.publicBlog.back", { name: p.company.name })}
      </Link>
      <article className="grid gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">{p.title}</h1>
        <p className="text-sm text-muted-foreground">
          {p.publishedAt ? formatDate(p.publishedAt, locale, "UTC") : ""}
          {p.authorName ? ` · ${p.authorName}` : ""}
          {p.categories.length ? ` · ${p.categories.join(", ")}` : ""}
        </p>
        {p.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed asset URL
          <img src={p.image} alt="" className="w-full rounded-xl object-cover" />
        ) : null}
        <div className="prose prose-neutral max-w-none dark:prose-invert [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:ms-5 [&_ol]:list-decimal [&_p]:my-3 [&_ul]:list-disc [&_a]:underline" dangerouslySetInnerHTML={{ __html: html }} />
        {p.tags.length ? <p className="text-xs text-muted-foreground">{p.tags.map((x) => `#${x}`).join(" ")}</p> : null}
      </article>
      {ld ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} /> : null}
    </main>
  );
}
