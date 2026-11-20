import { World } from "@/components/ui/world";

/** Module world (Design DNA v2): every /graph page inherits the "brain" world tokens, ambient light and texture. */
export default function Layout({ children }: LayoutProps<"/[locale]/graph">) {
  return <World name="brain">{children}</World>;
}
