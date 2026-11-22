import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** Module world (Design DNA v2): every /graph page inherits the "brain" world tokens, ambient light and texture. */
export default function Layout({ children }: LayoutProps<"/[locale]/graph">) {
  return (
    <ClientMessages scope="[locale]/(app)/graph">
      <World name="brain">{children}</World>
    </ClientMessages>
  );
}
