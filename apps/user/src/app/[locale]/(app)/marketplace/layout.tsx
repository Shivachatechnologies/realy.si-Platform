import { World } from "@/components/ui/world";
import { PageHeader } from "@/components/ui/page-header";
import { MarketplaceTabs } from "@/components/marketplace/marketplace-tabs";
import { getLocale, getT } from "@/i18n/server";
import { can } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { requireViewer } from "@/server/session";
import { ClientMessages } from "@/components/i18n/client-messages";

export default async function MarketplaceLayout({ children }: LayoutProps<"/[locale]/marketplace">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const reviewer = (await can(viewer.ctx, "platform.content.manage", platformChain())) || (await can(viewer.ctx, "platform.organizations.manage", platformChain()));
  return (
    <ClientMessages scope="[locale]/(app)/marketplace">
      <World name="marketplace" className="mx-auto grid max-w-[1400px] gap-5">
        <PageHeader variant="editorial" world="marketplace" eyebrow={t("dna.worlds.marketplace")} title={t("marketplace.title")} description={t("marketplace.subtitle")} />
        <MarketplaceTabs reviewer={reviewer} />
        {children}
      </World>
    </ClientMessages>
  );
}
