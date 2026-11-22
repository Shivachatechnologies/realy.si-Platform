import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** Module world (Design DNA v2): every /builder page inherits the "command" world tokens, ambient light and texture. */
export default function Layout({ children }: LayoutProps<"/[locale]/builder">) {
  return (
    <ClientMessages scope="[locale]/(app)/builder">
      <World name="command">{children}</World>
    </ClientMessages>
  );
}
