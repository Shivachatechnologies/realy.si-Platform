import type { Metadata } from "next";
import { closestLocale } from "@/i18n/config";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { publicBlog } from "@/server/modules/marketing/blog";

export async function generateMetadata({ params }: PageProps<"/[locale]/blog/[companyId]">): Promise<Metadata> {
  const { companyId } = await params;
  const b = await publicBlog(companyId, 1);
  return { title: b ? `${b.brand?.brandName ?? b.company.name} — Blog` : "Blog", description: b?.brand?.tagline ?? undefined };
}

/** Realy-hosted public blog for companies without their own CMS. */
export default async function PublicBlog({ params, searchParams }: PageProps<"/[locale]/blog/[companyId]">) {
  const { locale, companyId } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Math.min(1000, Number(sp.page) || 1));
  const category = typeof sp.category === "string" ? sp.category.slice(0, 60) : undefined;
  const b = await publicBlog(companyId, page, category);
  if (!b) notFound();
  const t = await getT(closestLocale(locale));
  const name = b.brand?.brandName ?? b.company.name;
  const pages = Math.ceil(b.total / b.pageSize);
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-10">
      <header className="grid gap-2 text-center">
        {b.brand?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- brand logo URL
          <img src={b.brand.logoUrl} alt={name} className="mx-auto max-h-12 w-auto" />
        ) : null}
        <h1 className="text-3xl font-semibold tracking-tight">{t("marketing.studio.publicBlog.title", { name })}</h1>
        {b.brand?.tagline ? <p className="text-muted-foreground">{b.brand.tagline}</p> : null}
        {b.categories.length ? (
          <nav className="mt-2 flex flex-wrap justify-center gap-2 text-sm" aria-label={t("marketing.studio.publicBlog.categories")}>
            <Link href={`/${locale}/blog/${companyId}`} className={`rounded-full border px-3 py-1 ${!category ? "bg-accent" : ""}`}>
              {t("marketing.studio.publicBlog.all")}
            </Link>
            {b.categories.map((c) => (
              <Link key={c} href={`/${locale}/blog/${companyId}?category=${encodeURIComponent(c)}`} className={`rounded-full border px-3 py-1 ${category === c ? "bg-accent" : ""}`}>
                {c}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>
      {b.posts.length === 0 ? (
        <p className="text-center text-muted-foreground">{t("marketing.studio.publicBlog.empty")}</p>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {b.posts.map((p) => (
            <li key={p.id}>
              <Link href={`/${locale}/blog/${companyId}/${p.slug}`} className="hover-lift grid h-full gap-3 overflow-hidden rounded-xl border bg-surface">
                {p.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed asset URL
                  <img src={p.image} alt="" className="aspect-video w-full object-cover" loading="lazy" />
                ) : null}
                <div className="grid gap-2 p-4">
                  <h2 className="font-semibold">{p.title}</h2>
                  <p className="line-clamp-3 text-sm text-muted-foreground">{p.excerpt}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.publishedAt ? formatDate(p.publishedAt, locale, "UTC") : ""}
                    {p.authorName ? ` · ${p.authorName}` : ""}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 ? (
        <nav className="flex justify-between text-sm" aria-label={t("marketing.common.pagination")}>
          {page > 1 ? <Link href={`/${locale}/blog/${companyId}?page=${page - 1}${category ? `&category=${encodeURIComponent(category)}` : ""}`}>{t("common.previous")}</Link> : <span />}
          {page < pages ? <Link href={`/${locale}/blog/${companyId}?page=${page + 1}${category ? `&category=${encodeURIComponent(category)}` : ""}`}>{t("common.next")}</Link> : null}
        </nav>
      ) : null}
    </main>
  );
}
