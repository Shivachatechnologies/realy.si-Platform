import Link from "next/link";
import { cn } from "@/lib/utils";

/** Lifecycle order: research → strategy → create → schedule → publish → monitor → analyze → optimize, then audience tools. */
export const MARKETING_TABS = ["overview", "run", "start", "intelligence", "strategy", "autopilot", "studio", "campaigns", "content", "calendar", "social", "community", "seo", "blog", "email", "ads", "influencers", "analytics", "optimize", "audience", "forms", "automation", "brand"] as const;
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
