import type { ReactNode } from "react";
import { PageHeader as EditorialHeader } from "@/components/ui/page-header";

/**
 * Header of every AI Workforce page: the Design DNA v2 editorial header in the "command" world (serif display title,
 * world illustration, data rail). `illustration` replaces the world drawing (false hides it, e.g. on dense pages).
 */
export function PageHeader({ title, subtitle, actions, eyebrow, illustration }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; illustration?: ReactNode | false }) {
  return <EditorialHeader variant="editorial" world="command" eyebrow={eyebrow} title={title} description={subtitle} actions={actions} illustration={illustration} />;
}
