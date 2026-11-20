import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { ListingCard } from "@/components/marketplace/listing-card";
import { catalogText } from "@/components/marketplace/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { can } from "@/server/modules/rbac/service";
import { orgChain } from "@/server/modules/rbac/scope";
import { db } from "@/server/core/db";
import { LISTING_CATEGORIES, LISTING_TYPES } from "@/server/modules/marketplace/manifest";
import { parseListingFilters, searchListings, SORTS } from "@/server/modules/marketplace/service";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketplace.title") };
}

export default async function MarketplacePage({ searchParams }: PageProps<"/[locale]/marketplace">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  if (!(await can(viewer.ctx, "marketplace.read", orgChain(org.id)))) return <Notice tone="warning">{t("errors.forbidden")}</Notice>;
  const raw = await searchParams;
  const filters = parseListingFilters(raw);
  const [result, installed] = await Promise.all([
    searchListings(viewer.ctx, org.id, filters, catalogText(t)),
    company
      ? db().marketplaceInstallation.findMany({
          where: {
            organizationId: org.id,
            companyId: company.id,
            status: "ACTIVE",
          },
          select: { listingKey: true },
        })
      : Promise.resolve([]),
  ]);
  const installedKeys = new Set(installed.map((i) => i.listingKey));
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = {
      q: filters.q,
      type: filters.type,
      category: filters.category,
      pricing: filters.pricing,
      sort: filters.sort === "popular" ? undefined : filters.sort,
      page: String(filters.page),
      ...patch,
    };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "page" && v === "1")) p.set(k, v);
    const s = p.toString();
    return `/${locale}/marketplace${s ? `?${s}` : ""}`;
  };
  const filtered = !!(filters.q || filters.type || filters.category || filters.pricing);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-1.5">
        <Link
          href={qs({ type: undefined, page: undefined })}
          className={`rounded-full border px-2.5 py-1 text-xs ${!filters.type ? "border-primary bg-accent" : "hover:bg-muted"}`}
        >
          {t("common.all")}
        </Link>
        {LISTING_TYPES.map((type) => (
          <Link
            key={type}
            href={qs({ type, page: undefined })}
            aria-current={filters.type === type ? "true" : undefined}
            className={`rounded-full border px-2.5 py-1 text-xs ${filters.type === type ? "border-primary bg-accent" : "hover:bg-muted"}`}
          >
            {t(`marketplace.typesPlural.${type}`)}
          </Link>
        ))}
      </div>
      <Card>
        <form className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_11rem_9rem_10rem_auto]" action={`/${locale}/marketplace`}>
          {filters.type ? <input type="hidden" name="type" value={filters.type} /> : null}
          <Input name="q" type="search" defaultValue={filters.q ?? ""} maxLength={120} aria-label={t("marketplace.search")} placeholder={t("marketplace.searchPlaceholder")} />
          <Select name="category" defaultValue={filters.category ?? ""} aria-label={t("marketplace.category")}>
            <option value="">{t("marketplace.allCategories")}</option>
            {LISTING_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`marketplace.categories.${c}`)}
              </option>
            ))}
          </Select>
          <Select name="pricing" defaultValue={filters.pricing ?? ""} aria-label={t("marketplace.pricing.label")}>
            <option value="">{t("marketplace.pricing.any")}</option>
            <option value="free">{t("marketplace.pricing.free")}</option>
            <option value="paid">{t("marketplace.pricing.paid")}</option>
          </Select>
          <Select name="sort" defaultValue={filters.sort} aria-label={t("marketplace.sort.label")}>
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`marketplace.sort.${s}`)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            <Search aria-hidden />
            {t("marketplace.search")}
          </Button>
        </form>
      </Card>
      <p className="text-xs text-muted-foreground">{t("marketplace.resultCount", { count: result.total })}</p>
      {result.data.length === 0 ? (
        <Card className="grid gap-2 p-8 text-center">
          <p className="text-muted-foreground">{filtered ? t("marketplace.noMatches") : t("marketplace.empty")}</p>
          {filtered ? (
            <Link href={`/${locale}/marketplace`} className="text-sm text-primary hover:underline">
              {t("marketplace.clearFilters")}
            </Link>
          ) : null}
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {result.data.map((l) => (
            <ListingCard key={l.key} listing={l} t={t} locale={locale} installed={installedKeys.has(l.key)} />
          ))}
        </div>
      )}
      {result.pages > 1 ? (
        <nav className="flex items-center justify-center gap-2 text-sm" aria-label={t("marketplace.pagination")}>
          {result.page > 1 ? (
            <Link className="rounded-md border px-3 py-1 hover:bg-muted" href={qs({ page: String(result.page - 1) })}>
              {t("common.previous")}
            </Link>
          ) : null}
          <span className="text-muted-foreground">
            {t("marketplace.pageOf", {
              page: result.page,
              pages: result.pages,
            })}
          </span>
          {result.page < result.pages ? (
            <Link className="rounded-md border px-3 py-1 hover:bg-muted" href={qs({ page: String(result.page + 1) })}>
              {t("common.next")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
