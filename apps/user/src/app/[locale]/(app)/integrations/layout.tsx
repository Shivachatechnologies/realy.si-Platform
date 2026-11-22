import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** Module world (Design DNA v2): every /integrations page inherits the "integrations" world tokens, ambient light and texture. */
export default function Layout({ children }: LayoutProps<"/[locale]/integrations">) {
  return (
    <ClientMessages scope="[locale]/(app)/integrations">
      <World name="integrations">{children}</World>
    </ClientMessages>
  );
}
