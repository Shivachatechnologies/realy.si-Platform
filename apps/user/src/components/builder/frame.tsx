import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { BuilderTabs, type BuilderTab } from "./builder-tabs";

export const RUN_TONE = { DRAFT: "neutral", RUNNING: "info", WAITING_INPUT: "warning", FAILED: "danger", COMPLETED: "success", CANCELLED: "neutral" } as const;
export const STEP_TONE = { PENDING: "neutral", RUNNING: "info", APPLYING: "info", WAITING_INPUT: "warning", COMPLETED: "success", FAILED: "danger", SKIPPED: "neutral", CANCELLED: "neutral" } as const;

/** Page frame of the AI Company Builder: header, secondary tabs, content. */
export function BuilderFrame({ locale, active, title, description, actions, meta, children }: { locale: string; active: BuilderTab; title: ReactNode; description?: ReactNode; actions?: ReactNode; meta?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      <PageHeader variant="editorial" world="automation" icon={<Sparkles />} title={title} description={description} actions={actions} meta={meta}>
        <BuilderTabs locale={locale} active={active} />
      </PageHeader>
      {children}
    </div>
  );
}
