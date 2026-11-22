import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** projects: themed as the "projects" world (Design DNA v2 — accent, ambient light and texture for every page in this area). */
export default function WorldLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientMessages scope="[locale]/(app)/projects">
      <World name="projects">{children}</World>
    </ClientMessages>
  );
}
