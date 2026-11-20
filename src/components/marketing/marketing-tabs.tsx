import Link from "next/link";
import { cn } from "@/lib/utils";

export const MARKETING_TABS = ["overview", "start", "autopilot", "studio", "campaigns", "content", "social", "community", "seo", "blog", "email", "ads", "influencers", "analytics", "audience", "forms", "automation", "brand"] as const;
export type MarketingTab = (typeof MARKETING_TABS)[number];

/** Secondary navigation shared by all Marketing OS pages. */
export function MarketingTabs({ locale, active, labels }: { locale: string; active: MarketingTab; labels: Record<MarketingTab, string> }) {
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b px-1 text-sm" aria-label={labels.overview}>
      {MARKETING_TABS.map((tab) => (
        <Link
          key={tab}
          href={`/${locale}/marketing${tab === "overview" ? "" : `/${tab}`}`}
          aria-current={active === tab ? "page" : undefined}
          className={cn("-mb-px shrink-0 border-b-2 px-3 py-2", active === tab ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {labels[tab]}
        </Link>
      ))}
    </nav>
  );
}
