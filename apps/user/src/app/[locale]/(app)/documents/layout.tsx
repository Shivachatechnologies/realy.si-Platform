import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** Module world (Design DNA v2): every /documents page inherits the "brain" world tokens, ambient light and texture. */
export default function Layout({ children }: LayoutProps<"/[locale]/documents">) {
  return (
    <ClientMessages scope="[locale]/(app)/documents">
      <World name="brain">{children}</World>
    </ClientMessages>
  );
}
