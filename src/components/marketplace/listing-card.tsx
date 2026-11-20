import Link from "next/link";
import { BadgeCheck, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatNumber } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import type { ListingView } from "@/server/modules/marketplace/service";
import { priceLabel, Stars, TYPE_ICON } from "./shared";

export function ListingCard({ listing: l, t, locale, installed }: { listing: ListingView; t: Translate; locale: string; installed?: boolean }) {
  const Icon = TYPE_ICON[l.type];
  return (
    <Card className="flex flex-col gap-3 p-4 transition-colors hover:border-primary/40">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
          {l.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary external URL
            <img src={l.iconUrl} alt="" className="size-10 rounded-md object-cover" />
          ) : (
            <Icon className="size-5" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <Link href={`/${locale}/marketplace/${l.key}`} className="line-clamp-1 font-medium hover:underline">
            {l.name}
          </Link>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {l.publisher.name}
            {l.publisher.verified ? <BadgeCheck className="size-3.5 text-primary" aria-label={t("marketplace.verified")} /> : null}
          </p>
        </div>
        {installed ? <Badge tone="success">{t("marketplace.installedBadge")}</Badge> : null}
      </div>
      <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">{l.summary}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="accent">{t(`marketplace.types.${l.type}`)}</Badge>
        <span className="font-medium">{priceLabel(t, locale, l)}</span>
        <span className="ms-auto flex items-center gap-2 text-muted-foreground">
          {l.ratingCount ? (
            <span className="flex items-center gap-1">
              <Stars
                value={l.ratingAvg}
                label={t("marketplace.ratingLabel", {
                  rating: l.ratingAvg.toFixed(1),
                  count: l.ratingCount,
                })}
              />
              <span className="tabular">{formatNumber(l.ratingCount, locale)}</span>
            </span>
          ) : null}
          <span className="flex items-center gap-1" title={t("marketplace.installCount", { count: l.installCount })}>
            <Download className="size-3.5" aria-hidden />
            <span className="tabular">{formatNumber(l.installCount, locale)}</span>
          </span>
        </span>
      </div>
    </Card>
  );
}
