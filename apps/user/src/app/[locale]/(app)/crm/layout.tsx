import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** crm: themed as the "sales" world (Design DNA v2 — accent, ambient light and texture for every page in this area). */
export default function WorldLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientMessages scope="[locale]/(app)/crm">
      <World name="sales">{children}</World>
    </ClientMessages>
  );
}
