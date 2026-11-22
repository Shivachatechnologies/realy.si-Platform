import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** Module world (Design DNA v2): every /communication page inherits the "people" world tokens, ambient light and texture. */
export default function Layout({ children }: LayoutProps<"/[locale]/communication">) {
  return (
    <ClientMessages scope="[locale]/(app)/communication">
      <World name="people">{children}</World>
    </ClientMessages>
  );
}
