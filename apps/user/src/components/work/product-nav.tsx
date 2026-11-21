import type { Translate } from "@/i18n/translate";
import { SectionTabs } from "./ui";

/** Secondary navigation of the product area (portfolio + company-wide product lists). */
export function ProductAreaTabs({ t, locale, active }: { t: Translate; locale: string; active: string }) {
  const p = `/${locale}/product`;
  return (
    <SectionTabs
      label={t("work.product.nav")}
      active={active}
      tabs={[
        { key: "products", href: p, label: t("product.tabs.products") },
        { key: "board", href: `${p}/board`, label: t("product.tabs.board") },
        { key: "roadmap", href: `${p}/roadmap`, label: t("work.product.tabs.roadmap") },
        { key: "features", href: `${p}/features`, label: t("work.product.tabs.features") },
        { key: "prioritization", href: `${p}/prioritization`, label: t("work.product.tabs.prioritization") },
        { key: "ideas", href: `${p}/ideas`, label: t("work.product.tabs.ideas") },
        { key: "feedback", href: `${p}/feedback`, label: t("work.product.tabs.feedback") },
        { key: "releases", href: `${p}/releases`, label: t("work.product.tabs.releases") },
      ]}
    />
  );
}

export const WORKSPACE_TABS = ["overview", "research", "documents", "features", "roadmap", "backlog", "releases", "feedback", "analytics", "plan"] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

/** Tabs of one product's workspace (/product/[productId]/…). */
export function ProductWorkspaceTabs({ t, locale, productId, active }: { t: Translate; locale: string; productId: string; active: WorkspaceTab }) {
  const p = `/${locale}/product/${productId}`;
  return (
    <SectionTabs
      label={t("product.workspace.nav")}
      active={active}
      tabs={WORKSPACE_TABS.map((key) => ({ key, href: key === "overview" ? p : `${p}/${key}`, label: t(`product.workspace.tabs.${key}`) }))}
    />
  );
}
