import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, Download } from "lucide-react";
import { InstallationActions, InstallPanel } from "@/components/marketplace/install-panel";
import { ManifestView } from "@/components/marketplace/manifest-view";
import { ReviewForm } from "@/components/marketplace/review-form";
import { catalogText, priceLabel, Stars, TYPE_ICON } from "@/components/marketplace/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { compareVersions } from "@/server/modules/marketplace/manifest";
import { getListing, isLive } from "@/server/modules/marketplace/service";
import { requireOrgContext } from "@/server/workspace";

type Props = PageProps<"/[locale]/marketplace/[publisher]/[slug]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const t = await getT();
  const builtin = t(`marketplace.catalog.${slug}.name`);
  return {
    title: builtin.startsWith("marketplace.") ? t("marketplace.title") : builtin,
  };
}

export default async function ListingPage({ params }: Props) {
  const { publisher, slug } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const key = `${publisher}/${slug}`;
  let data: Awaited<ReturnType<typeof getListing>>;
  try {
    data = await getListing(viewer.ctx, org.id, key, catalogText(t));
  } catch (e) {
    if (isAppError(e) && e.code === "not_found") notFound();
    if (isAppError(e) && e.code === "forbidden") return <Notice tone="warning">{t("errors.forbidden")}</Notice>;
    throw e;
  }
  const { listing: l, reviews, distribution } = data;
  const Icon = TYPE_ICON[l.type];
  const latest = l.versions[0];
  const chain = company ? await companyChain(db(), org.id, company.id) : null;
  const [canInstall, installation, workspaces, profile, orgInstalled] = await Promise.all([
    chain ? can(viewer.ctx, "marketplace.install", chain) : Promise.resolve(false),
    company
      ? db().marketplaceInstallation.findUnique({
          where: {
            companyId_listingKey: { companyId: company.id, listingKey: key },
          },
        })
      : Promise.resolve(null),
    company
      ? db().workspace.findMany({
          where: { organizationId: org.id, companyId: company.id },
          select: { id: true, name: true },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
    company
      ? db().enterpriseCompanyProfile.findUnique({
          where: { companyId: company.id },
          select: { fiscalYearStartMonth: true },
        })
      : Promise.resolve(null),
    db().marketplaceInstallation.findFirst({
      where: { organizationId: org.id, listingKey: key },
      select: { id: true },
    }),
  ]);
  const active = installation?.status === "ACTIVE" ? installation : null;
  const base = company ? `/api/v1/organizations/${org.id}/companies/${company.id}` : "";
  const own = l.publisher.organizationId === org.id;
  const myReview = reviews.find((r) => r.userId === viewer.user.id) ?? null;
  const tz = viewer.user.timezone;
  const description = l.description || l.summary;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid min-w-0 content-start gap-4">
        <Card className="p-4">
          <div className="flex flex-wrap items-start gap-4">
            <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
              {l.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary external URL
                <img src={l.iconUrl} alt="" className="size-14 rounded-lg object-cover" />
              ) : (
                <Icon className="size-7" aria-hidden />
              )}
            </span>
            <div className="grid min-w-0 flex-1 gap-1">
              <h2 className="text-xl font-semibold tracking-tight">{l.name}</h2>
              <Link href={`/${locale}/marketplace/publishers/${l.publisher.slug}`} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline">
                {l.publisher.name}
                {l.publisher.verified ? <BadgeCheck className="size-4 text-primary" aria-label={t("marketplace.verified")} /> : null}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <Badge tone="accent">{t(`marketplace.types.${l.type}`)}</Badge>
                <Badge>{t(`marketplace.categories.${l.category}`)}</Badge>
                {latest ? <Badge>v{latest.version}</Badge> : null}
                {!isLive(l) ? <Badge tone="warning">{t(`marketplace.statuses.${l.status}`)}</Badge> : null}
                {l.ratingCount ? (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Stars
                      value={l.ratingAvg}
                      label={t("marketplace.ratingLabel", {
                        rating: l.ratingAvg.toFixed(1),
                        count: l.ratingCount,
                      })}
                    />
                    {l.ratingAvg.toFixed(1)} ({formatNumber(l.ratingCount, locale)})
                  </span>
                ) : null}
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Download className="size-3.5" aria-hidden />
                  {t("marketplace.installCount", { count: l.installCount })}
                </span>
              </div>
            </div>
          </div>
          <p className="mt-4 whitespace-pre-line text-sm">{description}</p>
          {l.tags.length ? (
            <div className="mt-3 flex flex-wrap gap-1">
              {l.tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/${locale}/marketplace?q=${encodeURIComponent(tag)}`}
                  className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  #{tag}
                </Link>
              ))}
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader
            title={t("marketplace.detail.installs")}
            description={
              latest
                ? t("marketplace.detail.installsVersion", {
                    version: latest.version,
                  })
                : undefined
            }
          />
          <CardBody>
            {latest ? <ManifestView manifest={latest.manifest} t={t} locale={locale} /> : <p className="text-sm text-muted-foreground">{t("marketplace.detail.noVersions")}</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("marketplace.detail.versions")} />
          {l.versions.length ? (
            <ol className="divide-y">
              {l.versions.map((v) => (
                <li key={v.version} className="grid gap-0.5 px-4 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">v{v.version}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(v.releasedAt, locale, tz)}</span>
                    {active?.version === v.version ? <Badge tone="success">{t("marketplace.detail.installedHere")}</Badge> : null}
                  </div>
                  {v.changelog ? <p className="text-muted-foreground">{v.changelog}</p> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("marketplace.detail.noVersions")}</p>
          )}
        </Card>

        <Card>
          <CardHeader
            title={t("marketplace.reviews.heading")}
            description={t("marketplace.reviews.count", {
              count: l.ratingCount,
            })}
          />
          <CardBody className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <div className="grid content-start gap-1">
              <p className="text-3xl font-semibold">{l.ratingCount ? l.ratingAvg.toFixed(1) : "—"}</p>
              <Stars
                value={l.ratingAvg}
                label={t("marketplace.ratingLabel", {
                  rating: l.ratingAvg.toFixed(1),
                  count: l.ratingCount,
                })}
              />
              <ul className="mt-2 grid gap-1 text-xs">
                {distribution.map((d) => (
                  <li key={d.stars} className="flex items-center gap-2">
                    <span className="w-3 tabular">{d.stars}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
                      <span
                        className="block h-full bg-warning"
                        style={{
                          width: `${reviews.length ? (d.count / reviews.length) * 100 : 0}%`,
                        }}
                      />
                    </span>
                    <span className="w-6 text-end tabular text-muted-foreground">{d.count}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid content-start gap-4">
              {own ? (
                <p className="text-sm text-muted-foreground">{t("marketplace.reviews.ownListing")}</p>
              ) : orgInstalled && isLive(l) ? (
                <ReviewForm
                  orgId={org.id}
                  listingKey={key}
                  existing={
                    myReview
                      ? {
                          id: myReview.id,
                          rating: myReview.rating,
                          title: myReview.title,
                          body: myReview.body,
                        }
                      : null
                  }
                />
              ) : (
                <p className="text-sm text-muted-foreground">{t("marketplace.reviews.installFirst")}</p>
              )}
              {reviews.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("marketplace.reviews.empty")}</p>
              ) : (
                <ul className="grid divide-y">
                  {reviews.map((r) => (
                    <li key={r.id} className="grid gap-1 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Stars
                          value={r.rating}
                          label={t("marketplace.reviews.stars", {
                            count: r.rating,
                          })}
                        />
                        <span className="font-medium">{r.title}</span>
                      </div>
                      {r.body ? <p className="whitespace-pre-line text-sm">{r.body}</p> : null}
                      <p className="text-xs text-muted-foreground">
                        {r.authorName} · {formatDate(r.createdAt, locale, tz)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid content-start gap-4">
        <Card>
          <CardHeader title={t("marketplace.pricing.label")} />
          <CardBody className="grid gap-1">
            <p className="text-2xl font-semibold">{priceLabel(t, locale, l)}</p>
            <p className="text-xs text-muted-foreground">{l.pricingModel === "FREE" ? t("marketplace.pricing.freeHint") : t("marketplace.pricing.paidHint")}</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={active ? t("marketplace.install.installedTitle") : t("marketplace.install.title")} />
          <CardBody className="grid gap-3">
            {!company ? (
              <p className="text-sm text-muted-foreground">{t("company.empty")}</p>
            ) : active ? (
              <>
                <p className="text-sm">
                  {t("marketplace.install.installedVersion", {
                    version: active.version,
                    date: formatDate(active.installedAt, locale, tz),
                  })}
                  {active.pinned ? <Badge className="ms-2">{t("marketplace.install.pinned")}</Badge> : null}
                </p>
                <InstallationActions
                  base={base}
                  canInstall={canInstall}
                  installation={{
                    id: active.id,
                    version: active.version,
                    pinned: active.pinned,
                  }}
                  newerVersions={l.versions.filter((v) => compareVersions(v.version, active.version) > 0).map((v) => v.version)}
                />
                <Link href={`/${locale}/marketplace/installed#${active.id}`} className="text-sm text-primary hover:underline">
                  {t("marketplace.install.viewInstalled")}
                </Link>
              </>
            ) : latest ? (
              <InstallPanel
                base={base}
                listingKey={key}
                versions={l.versions.map((v) => ({
                  version: v.version,
                  config: v.manifest.config,
                }))}
                workspaces={workspaces}
                companyName={company.name}
                baseCurrency={company.baseCurrency}
                defaultFiscalMonth={profile?.fiscalYearStartMonth ?? latest.manifest.settings.fiscalYearStartMonth ?? 1}
                canInstall={canInstall}
                paid={l.pricingModel !== "FREE"}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t("marketplace.detail.noVersions")}</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
