import Link from "next/link";
import { cn } from "@/lib/utils";

export const HR_TABS = ["overview", "hire", "employees", "recruiting", "onboarding", "performance", "time", "leave", "policies", "requests", "payroll", "me"] as const;
export type HrTab = (typeof HR_TABS)[number];

const HREF: Record<HrTab, string> = {
  overview: "/hr",
  hire: "/hr/hire",
  employees: "/hr/employees",
  recruiting: "/hr/recruiting",
  onboarding: "/hr/onboarding",
  performance: "/hr/performance",
  time: "/hr/time",
  leave: "/hr/leave",
  policies: "/hr/policies",
  requests: "/hr/requests",
  payroll: "/hr/payroll",
  me: "/hr/me",
};

/** Secondary navigation of HR & People. Tabs the viewer can't use are omitted by the caller. */
export function HrTabs({ locale, active, labels, visible }: { locale: string; active: HrTab; labels: Record<HrTab, string>; visible: HrTab[] }) {
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b px-1 text-sm" aria-label={labels.overview}>
      {HR_TABS.filter((k) => visible.includes(k)).map((k) => (
        <Link
          key={k}
          href={`/${locale}${HREF[k]}`}
          aria-current={active === k ? "page" : undefined}
          className={cn("-mb-px shrink-0 border-b-2 px-3 py-2 whitespace-nowrap", active === k ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {labels[k]}
        </Link>
      ))}
    </nav>
  );
}

export const ORG_TABS = ["structure", "chart", "roles"] as const;
export type OrgTab = (typeof ORG_TABS)[number];

export function OrgTabs({ locale, active, labels }: { locale: string; active: OrgTab; labels: Record<OrgTab, string> }) {
  const href: Record<OrgTab, string> = { structure: "/organization", chart: "/organization/chart", roles: "/organization/roles" };
  return (
    <nav className="flex gap-1 overflow-x-auto border-b text-sm" aria-label="Organization">
      {ORG_TABS.map((k) => (
        <Link
          key={k}
          href={`/${locale}${href[k]}`}
          aria-current={active === k ? "page" : undefined}
          className={cn("-mb-px shrink-0 border-b-2 px-3 py-2", active === k ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {labels[k]}
        </Link>
      ))}
    </nav>
  );
}
