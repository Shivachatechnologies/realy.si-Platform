import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** autonomy: part of the AI Workforce area, themed as the "command" world (Design DNA v2). */
export default function WorldLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientMessages scope="[locale]/(app)/autonomy">
      <World name="command">{children}</World>
    </ClientMessages>
  );
}
