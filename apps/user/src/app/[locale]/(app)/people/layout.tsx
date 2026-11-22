import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** people: themed as the "people" world (Design DNA v2 — accent, ambient light and texture for every page in this area). */
export default function WorldLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientMessages scope="[locale]/(app)/people">
      <World name="people">{children}</World>
    </ClientMessages>
  );
}
