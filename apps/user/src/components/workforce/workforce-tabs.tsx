import Link from "next/link";
import { getT } from "@/i18n/server";
import { cn } from "@/lib/utils";

export type WorkforceTab = "employees" | "org" | "hire" | "usage" | "plans" | "tasks" | "performance" | "escalations" | "autonomy";

/**
 * Secondary navigation of the AI Workforce area (server component). The org chart tab shows when its label is given;
 * the performance, escalations and autonomy tabs are always shown and labelled here.
 */
export async function WorkforceTabs({
  locale,
  active,
  labels,
}: {
  locale: string;
  active: WorkforceTab;
  labels: Record<Exclude<WorkforceTab, "org" | "performance" | "escalations" | "autonomy">, string> & { org?: string };
}) {
  const t = await getT();
  const tabs: { key: WorkforceTab; href: string; label?: string }[] = [
    { key: "employees", href: `/${locale}/workforce`, label: labels.employees },
    { key: "org", href: `/${locale}/workforce/org`, label: labels.org },
    { key: "performance", href: `/${locale}/workforce/performance`, label: t("workforce.tabs.performance") },
    { key: "escalations", href: `/${locale}/workforce/escalations`, label: t("workforce.tabs.escalations") },
    { key: "autonomy", href: `/${locale}/autonomy`, label: t("workforce.tabs.autonomy") },
    { key: "hire", href: `/${locale}/workforce/hire`, label: labels.hire },
    { key: "usage", href: `/${locale}/workforce/usage`, label: labels.usage },
    { key: "plans", href: `/${locale}/plans`, label: labels.plans },
    { key: "tasks", href: `/${locale}/tasks`, label: labels.tasks },
  ];
  return (
    <nav className="flex gap-1 overflow-x-auto border-b text-sm" aria-label={labels.employees}>
      {tabs
        .filter((tab) => tab.label)
        .map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active === tab.key ? "page" : undefined}
            className={cn("-mb-px shrink-0 border-b-2 px-3 py-2.5", active === tab.key ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {tab.label}
          </Link>
        ))}
    </nav>
  );
}
