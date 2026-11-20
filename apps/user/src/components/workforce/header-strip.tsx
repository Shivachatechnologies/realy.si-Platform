import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import type { Translate } from "@/i18n/translate";

/** Plain-language strip under a page header: what this is, why it matters, what you can do here, and the next step. */
export function HeaderStrip({ t, what, why, can, next, action }: { t: Translate; what: ReactNode; why: ReactNode; can: ReactNode; next: ReactNode; action?: ReactNode }) {
  const item = (label: string, body: ReactNode) => (
    <div className="grid content-start gap-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">{label}</span>
      <span className="text-muted-foreground">{body}</span>
    </div>
  );
  return (
    <Card variant="glass" className="grid gap-3 p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      {item(t("workforce.strip.what"), what)}
      {item(t("workforce.strip.why"), why)}
      {item(t("workforce.strip.can"), can)}
      <div className="grid content-start gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">{t("workforce.strip.next")}</span>
        <span className="text-muted-foreground">{next}</span>
        {action ? <div>{action}</div> : null}
      </div>
    </Card>
  );
}
