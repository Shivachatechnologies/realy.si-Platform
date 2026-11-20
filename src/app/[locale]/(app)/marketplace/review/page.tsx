import type { Metadata } from "next";
import Link from "next/link";
import { ManifestView } from "@/components/marketplace/manifest-view";
import { ReviewDecision } from "@/components/marketplace/publish-forms";
import { priceLabel } from "@/components/marketplace/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { compareVersions } from "@/server/modules/marketplace/manifest";
import { listReviewQueue } from "@/server/modules/marketplace/service";
import { requireViewer } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketplace.tabs.review") };
}

/** Platform review queue (platform.content.manage or platform.organizations.manage). */
export default async function ReviewQueuePage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  let queue: Awaited<ReturnType<typeof listReviewQueue>>;
  try {
    queue = await listReviewQueue(viewer.ctx);
  } catch (e) {
    if (isAppError(e) && (e.code === "forbidden" || e.code === "mfa_required")) return <Notice tone="warning">{t(`errors.${e.code}`)}</Notice>;
    throw e;
  }
  if (!queue.length) return <Card className="p-8 text-center text-muted-foreground">{t("marketplace.review.empty")}</Card>;
  return (
    <div className="grid gap-4">
      {queue.map((l) => {
        const submitted = l.versions.filter((v) => !l.latestVersion || compareVersions(v.version, l.latestVersion) > 0);
        const v = submitted[0] ?? l.versions[0];
        return (
          <Card key={l.key}>
            <CardHeader
              title={l.name}
              description={
                <span>
                  <span className="font-mono">{l.key}</span> · {l.publisher.name} · {t(`marketplace.types.${l.type}`)} · {priceLabel(t, locale, l)}
                </span>
              }
              actions={
                l.latestVersion ? (
                  <Badge>
                    {t("marketplace.review.liveVersion", {
                      version: l.latestVersion,
                    })}
                  </Badge>
                ) : (
                  <Badge tone="accent">{t("marketplace.review.newListing")}</Badge>
                )
              }
            />
            <CardBody className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="grid gap-3">
                <p className="text-sm">{l.summary}</p>
                {l.description ? <p className="whitespace-pre-line text-sm text-muted-foreground">{l.description}</p> : null}
                {v ? (
                  <div className="grid gap-2 rounded-md border p-3">
                    <p className="text-sm font-medium">
                      {t("marketplace.review.submittedVersion", {
                        version: v.version,
                      })}{" "}
                      <span className="text-xs text-muted-foreground">{formatDate(v.releasedAt, locale, viewer.user.timezone)}</span>
                    </p>
                    {v.changelog ? <p className="text-sm text-muted-foreground">{v.changelog}</p> : null}
                    <ManifestView manifest={v.manifest} t={t} locale={locale} />
                  </div>
                ) : null}
                {l.latestVersion ? (
                  <Link href={`/${locale}/marketplace/${l.key}`} className="text-sm text-primary hover:underline">
                    {t("marketplace.publish.viewLive")}
                  </Link>
                ) : null}
              </div>
              <ReviewDecision listingId={l.id!} />
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
