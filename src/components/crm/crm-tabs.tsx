import Link from "next/link";
import { cn } from "@/lib/utils";

/** Leads | Dashboard switcher shared by the CRM pages. */
export function CrmTabs({ locale, active, labels }: { locale: string; active: "leads" | "dashboard"; labels: { leads: string; dashboard: string } }) {
  const tabs = [
    { key: "leads", href: `/${locale}/crm` },
    { key: "dashboard", href: `/${locale}/crm/dashboard` },
  ] as const;
  return (
    <nav className="flex gap-1 border-b text-sm" aria-label="CRM">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={cn("-mb-px border-b-2 px-3 py-2", active === tab.key ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {labels[tab.key]}
        </Link>
      ))}
    </nav>
  );
}
