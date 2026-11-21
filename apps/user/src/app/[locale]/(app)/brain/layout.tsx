import { World } from "@/components/ui/world";

/** Module world (Design DNA v2): every /brain page inherits the "brain" world tokens, ambient light and texture. */
export default function Layout({ children }: LayoutProps<"/[locale]/brain">) {
  return <World name="brain">{children}</World>;
}
