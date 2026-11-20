import Link from "next/link";
import { cn } from "@/lib/utils";

export type WorkforceTab = "employees" | "hire" | "usage" | "plans" | "tasks";

/** Secondary navigation of the AI Workforce area. */
export function WorkforceTabs({ locale, active, labels }: { locale: string; active: WorkforceTab; labels: Record<WorkforceTab, string> }) {
  const tabs: { key: WorkforceTab; href: string }[] = [
    { key: "employees", href: `/${locale}/workforce` },
    { key: "hire", href: `/${locale}/workforce/hire` },
    { key: "usage", href: `/${locale}/workforce/usage` },
    { key: "plans", href: `/${locale}/plans` },
    { key: "tasks", href: `/${locale}/tasks` },
  ];
  return (
    <nav className="flex gap-1 overflow-x-auto border-b text-sm" aria-label={labels.employees}>
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
