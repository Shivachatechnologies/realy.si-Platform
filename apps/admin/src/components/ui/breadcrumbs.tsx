import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  /** Omit for the current page (the last item). */
  href?: string;
}

/** Presentational breadcrumb trail; the last item is the current page. The admin shell derives items from the nav registry. */
export function Breadcrumbs({ items, label, className }: { items: BreadcrumbItem[]; label: string; className?: string }) {
  if (!items.length) return null;
  return (
    <nav aria-label={label} className={cn("min-w-0", className)}>
      <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}:${item.label}`} className="flex min-w-0 items-center gap-1">
              {i > 0 ? <ChevronRight className="size-3 shrink-0 rtl:-scale-x-100" aria-hidden /> : null}
              {item.href && !last ? (
                <Link href={item.href} className="truncate hover:text-foreground hover:underline focus-visible:outline-2">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={cn("truncate", last && "font-medium text-foreground")}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
