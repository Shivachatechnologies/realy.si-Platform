import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** Module world (Design DNA v2): every /onboarding page inherits the "command" world tokens, ambient light and texture. */
export default function Layout({ children }: LayoutProps<"/[locale]/onboarding">) {
  return (
    <ClientMessages scope="[locale]/(journey)/onboarding">
      <World name="command">{children}</World>
    </ClientMessages>
  );
}
