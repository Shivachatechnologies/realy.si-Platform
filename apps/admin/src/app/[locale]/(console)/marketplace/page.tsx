import Link from "next/link";
import { BadgeCheck, Store, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Empty, EmptyState, FilterBar, QuickFilters, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { ListingModerate, ListingReview, PublisherVerify } from "@/components/admin/platform-actions";
import { getLocale, getT } from "@/i18n/server";
import { formatMoney, formatRelativeTime } from "@/i18n/format";
import { marketplaceAdminOverview } from "@/server/modules/admin/marketplace";
import { requireViewer } from "@/server/session";

const TONE = { DRAFT: "neutral", IN_REVIEW: "warning", PUBLISHED: "success", REJECTED: "danger", ARCHIVED: "neutral" } as const;

/** Marketplace management: review queue, moderation (approve / reject / unlist / relist) and publishers. */
export default async function AdminMarketplacePage({ searchParams }: PageProps<"/[locale]/marketplace">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const params = { status: sp(q.status) ?? "IN_REVIEW", q: sp(q.q), publisher: sp(q.publisher) };
  const r = await guard(marketplaceAdminOverview(viewer.ctx, params), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const o = r.value;
  const base = `/${locale}/marketplace`;
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<Store />} title={t("admin.nav.marketplace")} description={t("admin.marketplace.subtitle")} why={t("admin.marketplace.why")} />
      <StatGrid>
        <StatTile label={t("admin.marketplace.status.IN_REVIEW")} value={o.counts.IN_REVIEW ?? 0} href={`${base}?status=IN_REVIEW`} tone={o.counts.IN_REVIEW ? "warning" : undefined} />
        <StatTile label={t("admin.marketplace.status.PUBLISHED")} value={o.counts.PUBLISHED ?? 0} href={`${base}?status=PUBLISHED`} tone="success" />
        <StatTile label={t("admin.marketplace.status.ARCHIVED")} value={o.counts.ARCHIVED ?? 0} href={`${base}?status=ARCHIVED`} />
        <StatTile icon={<Users />} label={t("admin.marketplace.publishers")} value={o.publishers.length} hint={t("admin.marketplace.verifiedCount", { count: o.publishers.filter((p) => p.verified).length })} />
      </StatGrid>
      <Card>
        <QuickFilters
          base={base}
          name="status"
          value={params.status}
          params={params}
          label={t("admin.users.filters.status")}
          options={(["IN_REVIEW", "PUBLISHED", "REJECTED", "ARCHIVED", "DRAFT"] as const).map((s) => ({ value: s, label: t(`admin.marketplace.status.${s}`), count: o.counts[s] ?? 0 }))}
        />
        <FilterBar action={base} q={params.q} qLabel={t("admin.marketplace.search")} values={params} submitLabel={t("admin.users.searchButton")} filters={[]} extra={<input type="hidden" name="status" value={params.status} />} />
        {o.listings.length === 0 ? (
          <EmptyState icon={<Store />} title={params.status === "IN_REVIEW" ? t("admin.marketplace.queueEmpty") : t("common.noResults")} body={t("admin.marketplace.queueEmptyHint")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.marketplace.listing")}</Th>
                <Th>{t("admin.marketplace.publisher")}</Th>
                <Th>{t("admin.marketplace.version")}</Th>
                <Th>{t("admin.marketplace.price")}</Th>
                <Th>{t("admin.users.columns.status")}</Th>
                <Th className="text-end">{t("admin.common.actions")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.listings.map((l) => (
                <Tr key={l.id}>
                  <Td>
                    <div className="font-medium">{l.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {l.listingKey} · {l.type} · {l.category}
                    </div>
                    <div className="line-clamp-1 text-xs text-muted-foreground">{l.summary}</div>
                  </Td>
                  <Td className="text-xs">
                    {l.publisher.name} {l.publisher.verified ? <BadgeCheck className="inline size-3.5 text-primary" aria-label={t("admin.marketplace.verified")} /> : null}
                  </Td>
                  <Td className="text-xs">
                    <span className="font-mono">{l.versions[0]?.version ?? "—"}</span>
                    {l.latestVersion && l.versions[0]?.version !== l.latestVersion ? <div className="text-[11px] text-muted-foreground">{t("admin.marketplace.live", { version: l.latestVersion })}</div> : null}
                    {l.submittedAt ? <div className="text-[11px] text-muted-foreground">{formatRelativeTime(l.submittedAt, locale)}</div> : null}
                  </Td>
                  <Td className="text-xs">{l.pricingModel === "FREE" || !l.priceMinor || !l.currency ? t("admin.marketplace.free") : formatMoney({ amountMinor: l.priceMinor, currency: l.currency }, locale)}</Td>
                  <Td>
                    <Badge tone={TONE[l.status]}>{t(`admin.marketplace.status.${l.status}`)}</Badge>
                    <div className="text-[11px] text-muted-foreground">{t("admin.marketplace.installs", { count: l.installs })}</div>
                    {l.reviewNote ? <div className="line-clamp-1 text-[11px] text-muted-foreground">“{l.reviewNote}”</div> : null}
                  </Td>
                  <Td className="text-end">
                    {l.status === "IN_REVIEW" ? <ListingReview listingId={l.id} name={l.name} /> : null}
                    {l.status === "PUBLISHED" ? <ListingModerate listingId={l.id} name={l.name} listed /> : null}
                    {l.status === "ARCHIVED" && l.latestVersion ? <ListingModerate listingId={l.id} name={l.name} listed={false} /> : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader icon={<Users />} title={t("admin.marketplace.publishers")} description={t("admin.marketplace.publishersHint")} />
        {o.publishers.length === 0 ? (
          <Empty>{t("admin.marketplace.noPublishers")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.marketplace.publisher")}</Th>
                <Th>{t("admin.organizations.columns.name")}</Th>
                <Th>{t("admin.marketplace.listings")}</Th>
                <Th className="text-end">{t("admin.common.actions")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.publishers.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <Link href={`${base}?status=PUBLISHED&publisher=${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>{" "}
                    {p.verified ? <Badge tone="info">{t("admin.marketplace.verified")}</Badge> : null}
                    <div className="font-mono text-[11px] text-muted-foreground">{p.slug}</div>
                  </Td>
                  <Td className="text-xs">
                    <Link href={`/${locale}/organizations/${p.organizationId}`} className="hover:underline">
                      {p.organizationName}
                    </Link>
                  </Td>
                  <Td className="tabular-nums">{p.listings}</Td>
                  <Td className="text-end">
                    <PublisherVerify publisherId={p.id} name={p.name} verified={p.verified} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
