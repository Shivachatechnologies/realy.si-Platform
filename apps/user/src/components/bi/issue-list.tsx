import Link from "next/link";
import { AlertOctagon, AlertTriangle } from "lucide-react";
import type { Translate } from "@/i18n/translate";
import type { Issue } from "@/server/modules/bi/issues";

/** Deterministic critical issues, rendered in the viewer's language. */
export function IssueList({ issues, t, locale, emptyLabel }: { issues: Issue[]; t: Translate; locale: string; emptyLabel: string }) {
  if (!issues.length) return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  return (
    <ul className="grid gap-2">
      {issues.map((i, n) => {
        const params = { ...i.params, ...(typeof i.params.metric === "string" ? { metric: t(i.params.metric) } : {}) };
        const text = t(`intelligence.issues.${i.kind}`, params);
        const Icon = i.severity === "critical" ? AlertOctagon : AlertTriangle;
        return (
          <li key={n} className="flex items-start gap-2 text-sm">
            <Icon aria-hidden className={i.severity === "critical" ? "mt-0.5 size-4 shrink-0 text-danger" : "mt-0.5 size-4 shrink-0 text-warning"} />
            <span className="sr-only">{t(`intelligence.severity.${i.severity}`)}: </span>
            {i.href ? (
              <Link className="hover:underline" href={`/${locale}${i.href}`}>
                {text}
              </Link>
            ) : (
              <span>{text}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
