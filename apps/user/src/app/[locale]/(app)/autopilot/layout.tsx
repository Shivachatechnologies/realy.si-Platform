import { World } from "@/components/ui/world";

/** autopilot: part of the AI Workforce area, themed as the "command" world (Design DNA v2). */
export default function WorldLayout({ children }: { children: React.ReactNode }) {
  return <World name="command">{children}</World>;
}
