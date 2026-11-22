import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** website: themed as the "marketing" world (Design DNA v2). */
export default function WorldLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientMessages scope="[locale]/(app)/website">
      <World name="marketing">{children}</World>
    </ClientMessages>
  );
}
