import Link from "next/link";
import { cn } from "@/lib/utils";

export type IntegrationsTab = "marketplace" | "connected" | "webhooks" | "syncs";

/** Secondary navigation of the Integrations area. */
export function IntegrationsTabs({ locale, active, labels }: { locale: string; active: IntegrationsTab; labels: Record<IntegrationsTab, string> }) {
  const tabs: { key: IntegrationsTab; href: string }[] = [
    { key: "marketplace", href: `/${locale}/integrations` },
    { key: "connected", href: `/${locale}/integrations?view=connected` },
    { key: "webhooks", href: `/${locale}/integrations/webhooks` },
    { key: "syncs", href: `/${locale}/integrations/syncs` },
  ];
  return (
    <nav className="flex gap-1 overflow-x-auto border-b text-sm" aria-label="Integrations">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2", active === tab.key ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {labels[tab.key]}
        </Link>
      ))}
    </nav>
  );
}
