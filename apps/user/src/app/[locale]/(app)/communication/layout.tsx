import { World } from "@/components/ui/world";

/** Module world (Design DNA v2): every /communication page inherits the "people" world tokens, ambient light and texture. */
export default function Layout({ children }: LayoutProps<"/[locale]/communication">) {
  return <World name="people">{children}</World>;
}
