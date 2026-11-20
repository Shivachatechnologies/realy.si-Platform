import Link from "next/link";
import { cn } from "@/lib/utils";

export type WorkflowsTab = "workflows" | "monitor" | "runs" | "approvals" | "templates";

/** Secondary navigation of the Workflows area. */
export function WorkflowsTabs({ locale, active, labels, pending }: { locale: string; active: WorkflowsTab; labels: Record<WorkflowsTab, string>; pending?: number }) {
  const tabs: { key: WorkflowsTab; href: string }[] = [
    { key: "workflows", href: `/${locale}/workflows` },
    { key: "monitor", href: `/${locale}/workflows/monitor` },
    { key: "runs", href: `/${locale}/workflows/runs` },
    { key: "approvals", href: `/${locale}/workflows/approvals` },
    { key: "templates", href: `/${locale}/workflows/templates` },
  ];
  return (
    <nav className="flex gap-1 overflow-x-auto border-b text-sm" aria-label="Workflows">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={cn("-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2", active === tab.key ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {labels[tab.key]}
          {tab.key === "approvals" && pending ? <span className="rounded-full bg-warning/15 px-1.5 text-[11px] font-medium text-warning">{pending}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
