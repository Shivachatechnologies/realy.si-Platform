import { World } from "@/components/ui/world";

/** Realy voice console: themed as the "command" world (Design DNA v2). */
export default function RealyLayout({ children }: { children: React.ReactNode }) {
  return <World name="command">{children}</World>;
}
