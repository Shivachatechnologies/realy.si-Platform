import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** command: themed as the "command" world (Design DNA v2 — accent, ambient light and texture for every page in this area). */
export default function WorldLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientMessages scope="[locale]/(app)/command">
      <World name="command">{children}</World>
    </ClientMessages>
  );
}
