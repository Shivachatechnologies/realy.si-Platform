import Link from "next/link";
import { cn } from "@/lib/utils";

/** Webhook management is not in the user app (Control Center only). */
export type IntegrationsTab = "marketplace" | "connected" | "usage" | "syncs";

/** Tab labels from a translator (server or client). */
export const integrationTabLabels = (t: (key: string) => string): Record<IntegrationsTab, string> => ({
  marketplace: t("integrations.tabs.marketplace"),
  connected: t("integrations.tabs.connected"),
  usage: t("integrations.tabs.usage"),
  syncs: t("integrations.tabs.syncs"),
});

/** Secondary navigation of the Integrations area. */
export function IntegrationsTabs({ locale, active, labels }: { locale: string; active: IntegrationsTab; labels: Record<IntegrationsTab, string> }) {
  const tabs: { key: IntegrationsTab; href: string }[] = [
    { key: "marketplace", href: `/${locale}/integrations` },
    { key: "connected", href: `/${locale}/integrations?view=connected` },
    { key: "usage", href: `/${locale}/integrations/usage` },
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
