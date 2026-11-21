import type { CSSProperties, ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Fade-up entrance on mount. `index` staggers siblings (delay = index × 55 ms).
 * `<RevealGroup>` staggers its direct children automatically (or by their own `--i`).
 * Pure CSS (works in Server Components); disabled under reduced motion.
 */
export function Reveal({
  as: Tag = "div",
  index = 0,
  className,
  style,
  children,
}: {
  as?: ElementType;
  index?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <Tag className={cn("reveal", className)} style={{ ...style, "--i": index } as CSSProperties}>
      {children}
    </Tag>
  );
}

export function RevealGroup({ as: Tag = "div", className, children }: { as?: ElementType; className?: string; children: ReactNode }) {
  return <Tag className={cn("stagger", className)}>{children}</Tag>;
}
