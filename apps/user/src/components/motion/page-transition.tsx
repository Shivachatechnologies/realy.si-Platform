"use client";

import { Suspense, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * Scene transition between pages: the new page rises in with a short fade/blur, keyed by pathname (search-param
 * changes do not re-animate). The first render is never hidden (no flash before hydration, content stays visible for
 * no-JS and LCP); reduced motion renders children as-is.
 */
function Keyed({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  // The path the page was loaded on renders without an entrance (no hidden content before hydration).
  const [firstPath] = useState(pathname);
  const isFirst = firstPath === pathname;
  if (reduced) return <>{children}</>;
  return (
    <motion.div
      key={pathname}
      initial={isFirst ? false : { opacity: 0, y: 10, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="min-w-0"
    >
      {children}
    </motion.div>
  );
}

export function PageTransition({ children }: { children: ReactNode }) {
  // usePathname is request data on dynamic routes: render children untouched until it is available.
  return (
    <Suspense fallback={children}>
      <Keyed>{children}</Keyed>
    </Suspense>
  );
}
