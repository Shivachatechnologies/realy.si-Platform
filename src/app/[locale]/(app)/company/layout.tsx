import { World } from "@/components/ui/world";

/** Module world (Design DNA v2): every /company page inherits the "command" world tokens, ambient light and texture. */
export default function Layout({ children }: LayoutProps<"/[locale]/company">) {
  return <World name="command">{children}</World>;
}
