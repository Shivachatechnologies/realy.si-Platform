import { World } from "@/components/ui/world";
import { ClientMessages } from "@/components/i18n/client-messages";

/** briefing: themed as the "command" world (the founder's command desk). */
export default function BriefingLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientMessages scope="[locale]/(app)/briefing">
      <World name="command">{children}</World>
    </ClientMessages>
  );
}
