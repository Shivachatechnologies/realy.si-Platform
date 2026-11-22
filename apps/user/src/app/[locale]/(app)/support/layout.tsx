import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** support: themed as the "support" world (Design DNA v2 — accent, ambient light and texture for every page in this area). */
export default function WorldLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientMessages scope="[locale]/(app)/support">
      <World name="support">{children}</World>
    </ClientMessages>
  );
}
