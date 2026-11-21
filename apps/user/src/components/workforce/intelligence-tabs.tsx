import Link from "next/link";
import { cn } from "@/lib/utils";

export type IntelligenceTab = "overview" | "ceo" | "growth";

/** Secondary navigation of the AI CEO area. */
export function IntelligenceTabs({ locale, active, labels }: { locale: string; active: IntelligenceTab; labels: Record<IntelligenceTab, string> }) {
  const tabs: { key: IntelligenceTab; href: string }[] = [
    { key: "overview", href: `/${locale}/intelligence` },
    { key: "ceo", href: `/${locale}/intelligence/ceo` },
    { key: "growth", href: `/${locale}/intelligence/growth` },
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
