import { World } from "@/components/ui/world";

/** Module world (Design DNA v2): every /onboarding page inherits the "command" world tokens, ambient light and texture. */
export default function Layout({ children }: LayoutProps<"/[locale]/onboarding">) {
  return <World name="command">{children}</World>;
}
