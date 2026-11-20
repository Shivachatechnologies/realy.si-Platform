import { MarketplaceTabs } from "@/components/marketplace/marketplace-tabs";
import { getLocale, getT } from "@/i18n/server";
import { can } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { requireViewer } from "@/server/session";

export default async function MarketplaceLayout({ children }: LayoutProps<"/[locale]/marketplace">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const reviewer = (await can(viewer.ctx, "platform.content.manage", platformChain())) || (await can(viewer.ctx, "platform.organizations.manage", platformChain()));
  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      <div className="grid gap-1">
        <h1 className="text-lg font-semibold tracking-tight">{t("marketplace.title")}</h1>
        <p className="text-muted-foreground">{t("marketplace.subtitle")}</p>
      </div>
      <MarketplaceTabs reviewer={reviewer} />
      {children}
    </div>
  );
}
