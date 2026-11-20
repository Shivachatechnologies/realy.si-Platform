import { World } from "@/components/ui/world";

/** Module world (Design DNA v2): every /documents page inherits the "brain" world tokens, ambient light and texture. */
export default function Layout({ children }: LayoutProps<"/[locale]/documents">) {
  return <World name="brain">{children}</World>;
}
