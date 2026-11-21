import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeCheck, Globe, Store } from "lucide-react";
import { ListingCard } from "@/components/marketplace/listing-card";
import { catalogText } from "@/components/marketplace/shared";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatNumber } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { getPublisherProfile } from "@/server/modules/marketplace/service";
import { requireOrgContext } from "@/server/workspace";

type Props = PageProps<"/[locale]/marketplace/publishers/[slug]">;

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketplace.publisher.title") };
}

export default async function PublisherPage({ params }: Props) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org } = await requireOrgContext(locale);
  let data: Awaited<ReturnType<typeof getPublisherProfile>>;
  try {
    data = await getPublisherProfile(viewer.ctx, org.id, slug, catalogText(t));
  } catch (e) {
    if (isAppError(e) && e.code === "not_found") notFound();
    if (isAppError(e) && e.code === "forbidden") return <Notice tone="warning">{t("errors.forbidden")}</Notice>;
    throw e;
  }
  const { publisher: p, listings } = data;
  const installs = listings.reduce((n, l) => n + l.installCount, 0);
  const rated = listings.filter((l) => l.ratingCount);
  const avg = rated.length ? rated.reduce((n, l) => n + l.ratingAvg * l.ratingCount, 0) / rated.reduce((n, l) => n + l.ratingCount, 0) : 0;
  const description = p.builtin ? t("marketplace.publisher.builtinDescription") : p.description;

  return (
    <div className="grid gap-4">
      <Card className="flex flex-wrap items-start gap-4 p-4">
        <span className="grid size-16 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
          {p.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary external URL
            <img src={p.logoUrl} alt="" className="size-16 rounded-lg object-cover" />
          ) : (
            <Store className="size-8" aria-hidden />
          )}
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            {p.name}
            {p.verified ? <BadgeCheck className="size-5 text-primary" aria-label={t("marketplace.verified")} /> : null}
          </h2>
          {description ? <p className="max-w-2xl whitespace-pre-line text-sm text-muted-foreground">{description}</p> : null}
          <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted-foreground">
            {p.website ? (
              <a href={p.website} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1 hover:underline">
                <Globe className="size-3.5" aria-hidden />
                {p.website.replace(/^https?:\/\//, "")}
              </a>
            ) : null}
            {p.createdAt ? (
              <span>
                {t("marketplace.publisher.since", {
                  date: formatDate(p.createdAt, locale, viewer.user.timezone),
                })}
              </span>
            ) : null}
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-4 text-center">
          <div>
            <dt className="text-xs text-muted-foreground">{t("marketplace.publisher.listings")}</dt>
            <dd className="text-lg font-semibold">{formatNumber(listings.length, locale)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("marketplace.publisher.installs")}</dt>
            <dd className="text-lg font-semibold">{formatNumber(installs, locale)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("marketplace.publisher.rating")}</dt>
            <dd className="text-lg font-semibold">{rated.length ? avg.toFixed(1) : "—"}</dd>
          </div>
        </dl>
      </Card>
      {listings.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">{t("marketplace.publisher.noListings")}</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {listings.map((l) => (
            <ListingCard key={l.key} listing={l} t={t} locale={locale} />
          ))}
        </div>
      )}
    </div>
  );
}
