import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** Module world (Design DNA v2): every /brain page inherits the "brain" world tokens, ambient light and texture. */
export default function Layout({ children }: LayoutProps<"/[locale]/brain">) {
  return (
    <ClientMessages scope="[locale]/(app)/brain">
      <World name="brain">{children}</World>
    </ClientMessages>
  );
}
