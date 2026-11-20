import type { ReactNode } from "react";
import { Info, TriangleAlert, CircleCheck, OctagonAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/** Inline status message. `title` (optional) renders a bold first line; `action` sits at the end. */
export function Notice({
  tone = "info",
  title,
  action,
  children,
  className,
}: {
  tone?: "info" | "warning" | "success" | "danger";
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const Icon = { success: CircleCheck, info: Info, warning: TriangleAlert, danger: OctagonAlert }[tone];
  const styles = {
    info: "border-border bg-surface-2/80 text-muted-foreground [--notice-accent:var(--info)]",
    warning: "border-warning/35 bg-warning/6 text-foreground [--notice-accent:var(--warning)]",
    success: "border-success/35 bg-success/6 text-foreground [--notice-accent:var(--success)]",
    danger: "border-danger/35 bg-danger/6 text-foreground [--notice-accent:var(--danger)]",
  }[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("relative flex items-start gap-2.5 overflow-hidden rounded-md border px-3 py-2.5 text-sm animate-fade-in", styles, className)}
    >
      <span aria-hidden className="absolute inset-y-0 start-0 w-0.5 bg-(--notice-accent) opacity-70" />
      <Icon className="mt-0.5 size-4 shrink-0 text-(color:--notice-accent)" aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium text-foreground">{title}</p> : null}
        <div className={cn(title && "mt-0.5")}>{children}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
