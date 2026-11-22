import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** Realy voice console: themed as the "command" world (Design DNA v2). */
export default function RealyLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientMessages scope="[locale]/(app)/realy">
      <World name="command">{children}</World>
    </ClientMessages>
  );
}
