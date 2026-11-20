import type { Translate } from "@/i18n/translate";
import { SectionTabs } from "./ui";

export function ProductTabs({ t, locale, active }: { t: Translate; locale: string; active: string }) {
  const p = `/${locale}/product`;
  return (
    <SectionTabs
      label={t("work.product.nav")}
      active={active}
      tabs={[
        { key: "roadmap", href: p, label: t("work.product.tabs.roadmap") },
        { key: "features", href: `${p}/features`, label: t("work.product.tabs.features") },
        { key: "prioritization", href: `${p}/prioritization`, label: t("work.product.tabs.prioritization") },
        { key: "ideas", href: `${p}/ideas`, label: t("work.product.tabs.ideas") },
        { key: "feedback", href: `${p}/feedback`, label: t("work.product.tabs.feedback") },
        { key: "releases", href: `${p}/releases`, label: t("work.product.tabs.releases") },
      ]}
    />
  );
}

export function OpsTabs({ t, locale, active }: { t: Translate; locale: string; active: string }) {
  const p = `/${locale}/operations`;
  return (
    <SectionTabs
      label={t("work.ops.nav")}
      active={active}
      tabs={[
        { key: "overview", href: p, label: t("work.ops.tabs.overview") },
        { key: "processes", href: `${p}/processes`, label: t("work.ops.tabs.processes") },
        { key: "checklists", href: `${p}/checklists`, label: t("work.ops.tabs.checklists") },
        { key: "assets", href: `${p}/assets`, label: t("work.ops.tabs.assets") },
        { key: "incidents", href: `${p}/incidents`, label: t("work.ops.tabs.incidents") },
        { key: "vendors", href: `${p}/vendors`, label: t("work.ops.tabs.vendors") },
      ]}
    />
  );
}
