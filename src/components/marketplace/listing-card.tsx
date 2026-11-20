import { WorldIllustration } from "@/components/graphics/illustrations";
import { hash } from "@/components/graphics/color";
import type { WorldName } from "@/components/ui/world";
import Link from "next/link";
import { BadgeCheck, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatNumber } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import type { ListingView } from "@/server/modules/marketplace/service";
import { priceLabel, Stars, TYPE_ICON } from "./shared";

const CATEGORY_WORLD: Record<string, WorldName> = {
  industry: "command",
  operations: "automation",
  sales: "sales",
  marketing: "marketing",
  finance: "finance",
  engineering: "product",
  support: "support",
  people: "people",
  productivity: "projects",
  data: "brain",
};

/** Gallery artwork: the category's world illustration on a seeded light field (deterministic per listing). */
function ListingCover({ listingKey, category }: { listingKey: string; category: string }) {
  const world = CATEGORY_WORLD[category] ?? "marketplace";
  const h = hash(listingKey);
  return (
    <div data-world={world} className="relative aspect-[16/8] overflow-hidden border-b" style={{ background: `radial-gradient(ellipse at ${15 + (h % 70)}% 20%, var(--world-ambient-1), transparent 65%), radial-gradient(ellipse at 90% 100%, var(--world-ambient-2), transparent 60%)` }}>
      <div aria-hidden className="absolute inset-0 opacity-70 [background:var(--world-texture)] mask-fade-b" />
      <WorldIllustration world={world} className="absolute inset-x-[14%] top-[8%] transition-transform duration-700 group-hover:scale-[1.04]" />
    </div>
  );
}

export function ListingCard({ listing: l, t, locale, installed }: { listing: ListingView; t: Translate; locale: string; installed?: boolean }) {
  const Icon = TYPE_ICON[l.type];
  return (
    <Card interactive className="group flex flex-col gap-3 overflow-hidden rounded-2xl p-0 pb-4 transition-colors hover:border-primary/40">
      <ListingCover listingKey={l.key} category={l.category} />
      <div className="flex items-start gap-3 px-4">
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
      <p className="line-clamp-2 min-h-10 px-4 text-sm text-muted-foreground">{l.summary}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 px-4 text-xs">
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
