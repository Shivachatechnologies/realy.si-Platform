import { World } from "@/components/ui/world";
import { PageHeader } from "@/components/ui/page-header";
import { MarketplaceTabs } from "@/components/marketplace/marketplace-tabs";
import { getLocale, getT } from "@/i18n/server";
import { requireViewer } from "@/server/session";

export default async function MarketplaceLayout({ children }: LayoutProps<"/[locale]/marketplace">) {
  const locale = await getLocale();
  const t = await getT(locale);
  await requireViewer(locale);
  return (
    <World name="marketplace" className="mx-auto grid max-w-[1400px] gap-5">
      <PageHeader variant="editorial" world="marketplace" eyebrow={t("dna.worlds.marketplace")} title={t("marketplace.title")} description={t("marketplace.subtitle")} />
      <MarketplaceTabs />
      {children}
    </World>
  );
}
