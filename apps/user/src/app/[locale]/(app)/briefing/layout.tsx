import { World } from "@/components/ui/world";

/** briefing: themed as the "command" world (the founder's command desk). */
export default function BriefingLayout({ children }: { children: React.ReactNode }) {
  return <World name="command">{children}</World>;
}
