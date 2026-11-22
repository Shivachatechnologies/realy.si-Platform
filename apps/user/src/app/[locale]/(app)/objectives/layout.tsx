import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** Module world (Design DNA v2): every /objectives page inherits the "projects" world tokens, ambient light and texture. */
export default function Layout({ children }: LayoutProps<"/[locale]/objectives">) {
  return (
    <ClientMessages scope="[locale]/(app)/objectives">
      <World name="projects">{children}</World>
    </ClientMessages>
  );
}
