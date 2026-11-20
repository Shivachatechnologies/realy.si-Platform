import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListingActions, ListingForm, VersionForm } from "@/components/marketplace/publish-forms";
import { ManifestView } from "@/components/marketplace/manifest-view";
import { STATUS_TONE } from "@/components/marketplace/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { can } from "@/server/modules/rbac/service";
import { orgChain } from "@/server/modules/rbac/scope";
import { compareVersions } from "@/server/modules/marketplace/manifest";
import { getOwnListing } from "@/server/modules/marketplace/service";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketplace.tabs.publish") };
}

function bump(v: string | undefined) {
  if (!v) return "1.0.0";
  const [a, b] = v.split(".").map(Number);
  return `${a}.${(b ?? 0) + 1}.0`;
}

export default async function EditListingPage({ params }: PageProps<"/[locale]/marketplace/publish/[listingId]">) {
  const { listingId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org } = await requireOrgContext(locale);
  let l: Awaited<ReturnType<typeof getOwnListing>>;
  try {
    l = await getOwnListing(viewer.ctx, org.id, listingId);
  } catch (e) {
    if (isAppError(e) && e.code === "not_found") notFound();
    if (isAppError(e) && e.code === "forbidden") return <Notice tone="warning">{t("errors.forbidden")}</Notice>;
    throw e;
  }
  const canManage = await can(viewer.ctx, "organizations.manage", orgChain(org.id));
  const newest = l.versions[0];
  const pending = l.versions.some((v) => !l.latestVersion || compareVersions(v.version, l.latestVersion) > 0);
  const canSubmit = canManage && l.versions.length > 0 && (l.status === "DRAFT" || l.status === "REJECTED" || (l.status === "PUBLISHED" && pending));
  const editable = canManage && l.status !== "ARCHIVED";

  return (
    <div className="grid gap-4">
      <Link href={`/${locale}/marketplace/publish`} className="text-sm text-muted-foreground hover:underline">
        ← {t("marketplace.publish.back")}
      </Link>
      <Card>
        <CardHeader
          title={l.name}
          description={<span className="font-mono">{l.key}</span>}
          actions={<Badge tone={STATUS_TONE[l.status]}>{t(`marketplace.statuses.${l.status}`)}</Badge>}
        />
        <CardBody className="grid gap-3">
          {l.status === "IN_REVIEW" ? <Notice tone="info">{t("marketplace.publish.inReview")}</Notice> : null}
          {l.reviewNote ? <Notice tone={l.status === "REJECTED" ? "danger" : "info"}>{t("marketplace.publish.reviewNote", { note: l.reviewNote })}</Notice> : null}
          {pending && l.latestVersion ? (
            <Notice tone="info">
              {t("marketplace.publish.pendingVersion", {
                live: l.latestVersion,
              })}
            </Notice>
          ) : null}
          {l.latestVersion ? (
            <Link href={`/${locale}/marketplace/${l.key}`} className="text-sm text-primary hover:underline">
              {t("marketplace.publish.viewLive")}
            </Link>
          ) : null}
          {canManage ? <ListingActions orgId={org.id} listingId={l.id!} canSubmit={canSubmit} canArchive={l.status !== "ARCHIVED"} /> : null}
        </CardBody>
      </Card>

      {editable ? (
        <Card>
          <CardHeader title={t("marketplace.publish.details")} />
          <CardBody>
            <ListingForm
              orgId={org.id}
              listingId={l.id!}
              initial={{
                name: l.name,
                type: l.type,
                category: l.category,
                summary: l.summary,
                description: l.description,
                tags: l.tags.join(", "),
                iconUrl: l.iconUrl ?? "",
                pricingModel: l.pricingModel,
                price: l.priceMinor !== null ? (Number(l.priceMinor) / 100).toFixed(2) : "",
                currency: l.currency ?? "USD",
              }}
            />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("marketplace.detail.versions")} />
        {l.versions.length ? (
          <ol className="divide-y">
            {l.versions.map((v) => (
              <li key={v.version} className="grid gap-2 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">v{v.version}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(v.releasedAt, locale, viewer.user.timezone)}</span>
                  {l.latestVersion && compareVersions(v.version, l.latestVersion) <= 0 ? (
                    <Badge tone="success">{t("marketplace.publish.approved")}</Badge>
                  ) : (
                    <Badge tone="warning">{t("marketplace.publish.awaitingReview")}</Badge>
                  )}
                </div>
                {v.changelog ? <p className="text-muted-foreground">{v.changelog}</p> : null}
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">{t("marketplace.detail.installs")}</summary>
                  <div className="mt-2">
                    <ManifestView manifest={v.manifest} t={t} locale={locale} />
                  </div>
                </details>
              </li>
            ))}
          </ol>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("marketplace.publish.noVersionsYet")}</p>
        )}
        {editable ? (
          <CardBody className="grid gap-3 border-t">
            <h3 className="font-medium">{t("marketplace.publish.newVersion")}</h3>
            <VersionForm orgId={org.id} listingId={l.id!} suggested={bump(newest?.version)} previousManifest={newest ? JSON.stringify(newest.manifest, null, 2) : null} />
          </CardBody>
        ) : null}
      </Card>
    </div>
  );
}
