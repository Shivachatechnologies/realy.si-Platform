import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** costs: spend control, themed as the "finance" world (Design DNA v2). */
export default function WorldLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientMessages scope="[locale]/(app)/costs">
      <World name="finance">{children}</World>
    </ClientMessages>
  );
}
