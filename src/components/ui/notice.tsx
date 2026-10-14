import type { ReactNode } from "react";
import { Info, TriangleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function Notice({ tone = "info", children, className }: { tone?: "info" | "warning" | "success" | "danger"; children: ReactNode; className?: string }) {
  const Icon = tone === "success" ? CircleCheck : tone === "info" ? Info : TriangleAlert;
  const styles = {
    info: "border-border bg-surface-2 text-muted-foreground",
    warning: "border-warning/40 bg-warning/5 text-foreground",
    success: "border-success/40 bg-success/5 text-foreground",
    danger: "border-danger/40 bg-danger/5 text-foreground",
  }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", styles, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
