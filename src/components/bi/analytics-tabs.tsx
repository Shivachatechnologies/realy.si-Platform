import Link from "next/link";
import { cn } from "@/lib/utils";

export type AnalyticsTab = "overview" | "ceo" | "departments" | "dashboards" | "reports" | "ai";

/** Secondary navigation of the Analytics area. */
export function AnalyticsTabs({ locale, active, labels }: { locale: string; active: AnalyticsTab; labels: Record<AnalyticsTab, string> }) {
  const tabs: { key: AnalyticsTab; href: string }[] = [
    { key: "overview", href: `/${locale}/analytics` },
    { key: "ceo", href: `/${locale}/analytics/ceo` },
    { key: "departments", href: `/${locale}/analytics/departments/sales` },
    { key: "dashboards", href: `/${locale}/analytics/dashboards` },
    { key: "reports", href: `/${locale}/analytics/reports` },
    { key: "ai", href: `/${locale}/analytics/ai` },
  ];
  return (
    <nav className="flex gap-1 overflow-x-auto border-b text-sm" aria-label={labels.overview}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={cn("-mb-px shrink-0 border-b-2 px-3 py-2", active === tab.key ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {labels[tab.key]}
        </Link>
      ))}
    </nav>
  );
}
