import { World } from "@/components/ui/world";

/** Module world (Design DNA v2): every /notifications page inherits the "command" world tokens, ambient light and texture. */
export default function Layout({ children }: LayoutProps<"/[locale]/notifications">) {
  return <World name="command">{children}</World>;
}
