import Link from "next/link";
import type { ChartNode } from "@/server/modules/hr/org";
import { personName } from "./shell";

type Person = { id: string; firstName: string; lastName: string | null; title: string | null; managerId: string | null; department: { name: string } | null };

/**
 * Collapsible reporting tree built from Employee.managerId. Native <details> keeps it accessible and JS-free; logical
 * properties (ps-/border-s) mirror it correctly in right-to-left locales.
 */
export function OrgChart({ nodes, locale, reportsLabel, depth = 0 }: { nodes: ChartNode<Person>[]; locale: string; reportsLabel: (n: number) => string; depth?: number }) {
  return (
    <ul className={depth ? "ms-4 grid gap-2 border-s ps-4" : "grid gap-2"}>
      {nodes.map((n) => {
        const card = (
          <span className="inline-flex min-w-0 flex-col rounded-md border bg-surface px-3 py-2 text-start shadow-xs">
            <Link href={`/${locale}/hr/employees/${n.person.id}`} className="truncate font-medium hover:underline">
              {personName(n.person)}
            </Link>
            <span className="truncate text-xs text-muted-foreground">{[n.person.title, n.person.department?.name].filter(Boolean).join(" · ") || "—"}</span>
          </span>
        );
        return (
          <li key={n.person.id}>
            {n.children.length ? (
              <details open={depth < 2} className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                  <span aria-hidden className="inline-block w-3 text-muted-foreground transition-transform group-open:rotate-90 rtl:-scale-x-100">
                    ▸
                  </span>
                  {card}
                  <span className="text-xs text-muted-foreground">{reportsLabel(n.size)}</span>
                </summary>
                <div className="mt-2">
                  <OrgChart nodes={n.children} locale={locale} reportsLabel={reportsLabel} depth={depth + 1} />
                </div>
              </details>
            ) : (
              <div className="flex items-center gap-2">
                <span aria-hidden className="inline-block w-3" />
                {card}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
