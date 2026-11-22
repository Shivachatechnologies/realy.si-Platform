import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** Creative studio: themed as the "marketing" world (Design DNA v2). */
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientMessages scope="[locale]/(app)/studio">
      <World name="marketing">{children}</World>
    </ClientMessages>
  );
}
