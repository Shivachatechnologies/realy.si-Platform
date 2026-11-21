import Link from "next/link";
import { CheckCircle2, CircleDashed, FileText, Loader2, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AiButton } from "@/components/work/actions";
import { formatDate } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import type { DeliverableState, stageDeliverables } from "@/server/modules/work/product-journey";

type Data = Awaited<ReturnType<typeof stageDeliverables>>;

const FILL: Record<DeliverableState, string> = {
  missing: "var(--surface)",
  drafting: "color-mix(in oklch, var(--warning) 35%, var(--surface))",
  draft: "color-mix(in oklch, var(--primary) 45%, var(--surface))",
  in_review: "color-mix(in oklch, var(--info, var(--primary)) 65%, var(--surface))",
  approved: "var(--success)",
};
const TONE: Record<DeliverableState, "neutral" | "warning" | "accent" | "info" | "success"> = { missing: "neutral", drafting: "warning", draft: "accent", in_review: "info", approved: "success" };

/**
 * Deliverables map: every lifecycle stage as a column of saved deliverables (SVG), coloured by their real state, and the
 * current stage's shelf with "open" and "draft with AI" actions. Nothing is shown as saved unless a version exists.
 */
export function DeliverablesMap({ t, locale, tz, base, ws, data, canEdit, canAi }: { t: Translate; locale: string; tz: string; base: string; ws: string; data: Data; canEdit: boolean; canAi: boolean }) {
  const n = data.stages.length;
  const W = 1000;
  const colW = W / n;
  const tokenH = 16;
  const maxItems = Math.max(...data.stages.map((s) => Math.max(1, s.total)));
  const H = 40 + maxItems * (tokenH + 6);
  const current = data.stages.find((s) => s.position === "current")!;
  return (
    <div className="grid gap-4">
      <figure className="grid gap-2" role="img" aria-label={t("productStudio.deliverables.mapLabel", { saved: data.saved, total: data.total })}>
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[40rem] rtl:-scale-x-100" aria-hidden>
            <defs>
              <linearGradient id="dm-spine" x1="0" x2="1">
                <stop offset="0" stopColor="var(--primary)" stopOpacity={0.9} />
                <stop offset="1" stopColor="var(--primary)" stopOpacity={0.15} />
              </linearGradient>
            </defs>
            <path d={`M ${colW / 2} 14 L ${W - colW / 2} 14`} stroke="var(--border)" strokeWidth={2} strokeDasharray="3 5" />
            <path d={`M ${colW / 2} 14 L ${colW / 2 + data.stages.indexOf(current) * colW} 14`} stroke="url(#dm-spine)" strokeWidth={3} strokeLinecap="round" />
            {data.stages.map((s, i) => {
              const cx = colW / 2 + i * colW;
              const tokens: { key: string; state: DeliverableState }[] = s.items.map((x) => ({ key: x.kind, state: x.state }));
              if (s.stage === "DEVELOPMENT") tokens.push({ key: "BACKLOG", state: data.backlog.tasks > 0 ? (data.backlog.done === data.backlog.tasks ? "approved" : "draft") : "missing" });
              return (
                <g key={s.stage}>
                  {s.position === "current" ? <circle cx={cx} cy={14} r={11} fill="var(--primary)" opacity={0.18} className="motion-safe:animate-pulse" /> : null}
                  <circle cx={cx} cy={14} r={s.position === "current" ? 7 : 5} fill={s.position === "future" ? "var(--surface)" : "var(--primary)"} stroke={s.position === "future" ? "var(--border)" : "var(--primary)"} strokeWidth={2} />
                  {tokens.map((tk, j) => (
                    <g key={tk.key}>
                      <line x1={cx} x2={cx} y1={j === 0 ? 21 : 34 + (j - 1) * (tokenH + 6) + tokenH} y2={34 + j * (tokenH + 6)} stroke="var(--border)" strokeWidth={1} />
                      <rect
                        x={cx - colW * 0.36}
                        y={34 + j * (tokenH + 6)}
                        width={colW * 0.72}
                        height={tokenH}
                        rx={5}
                        fill={FILL[tk.state]}
                        stroke={tk.state === "missing" ? "var(--border)" : "transparent"}
                        strokeDasharray={tk.state === "missing" ? "3 3" : undefined}
                      />
                    </g>
                  ))}
                </g>
              );
            })}
          </svg>
        </div>
        <ol className="grid min-w-0 text-[10px] leading-tight text-muted-foreground" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {data.stages.map((s, i) => (
            <li key={s.stage} className={cn("px-0.5 text-center", s.position === "current" && "font-semibold text-primary")}>
              <span className="hidden lg:inline">{t(`product.stages.${s.stage}`)}</span>
              <span className="lg:hidden">{i + 1}</span>
              <span className="block tabular-nums">{s.saved}/{s.total}</span>
            </li>
          ))}
        </ol>
        <figcaption className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {(["missing", "drafting", "draft", "in_review", "approved"] as const).map((st) => (
            <span key={st} className="inline-flex items-center gap-1">
              <span className={cn("inline-block h-2.5 w-4 rounded-sm", st === "missing" && "border border-dashed")} style={{ background: FILL[st] }} />
              {t(`productStudio.deliverables.states.${st}`)}
            </span>
          ))}
        </figcaption>
      </figure>

      <section className="grid gap-2" aria-labelledby="dm-current">
        <h3 id="dm-current" className="text-sm font-semibold">
          {t("productStudio.deliverables.currentTitle", { stage: t(`product.stages.${current.stage}`) })}
        </h3>
        <p className="text-xs text-muted-foreground">{t("productStudio.deliverables.gateRule")}</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {current.items.map((x) => (
            <li key={x.kind} className="grid gap-2 rounded-lg border bg-surface/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`${ws}/documents/${x.kind.toLowerCase()}`} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium hover:underline">
                  {x.state === "approved" ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : x.state === "drafting" ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : x.state === "missing" ? <CircleDashed className="size-4 text-muted-foreground" aria-hidden /> : <FileText className="size-4 text-primary" aria-hidden />}
                  {t(`product.docKinds.${x.kind}`)}
                </Link>
                <Badge tone={TONE[x.state]}>{t(`productStudio.deliverables.states.${x.state}`)}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{t(`product.docHints.${x.kind}`)}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {x.version ? <span>{t("productStudio.deliverables.version", { version: x.version, date: formatDate(x.updatedAt!, locale, tz) })}</span> : null}
                {x.task?.status === "COMPLETED" && x.state !== "approved" ? (
                  <Link href={`${ws}/documents/${x.kind.toLowerCase()}`} className="text-primary hover:underline">
                    {t("productStudio.deliverables.reviewDraft")}
                  </Link>
                ) : null}
                {canEdit && canAi && x.state !== "drafting" ? <AiButton url={`${base}/product/products/${data.productId}/docs/${x.kind.toLowerCase()}/ai`} label={x.version ? t("productStudio.deliverables.redraft") : t("productStudio.deliverables.draftAi")} /> : null}
              </div>
            </li>
          ))}
          {current.stage === "DEVELOPMENT" ? (
            <li className="grid gap-2 rounded-lg border bg-surface/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`${ws}/backlog`} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium hover:underline">
                  <ListChecks className="size-4 text-primary" aria-hidden />
                  {t("productStudio.deliverables.backlog")}
                </Link>
                <Badge tone={data.backlog.tasks ? "accent" : "neutral"}>{t("productStudio.deliverables.backlogCount", { done: data.backlog.done, total: data.backlog.tasks })}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{data.backlog.projectId ? t("productStudio.deliverables.sprints", { count: data.backlog.sprints }) : t("productStudio.deliverables.noProject")}</p>
              {data.backlog.projectId ? (
                <Link href={`/${locale}/projects/${data.backlog.projectId}/sprints`} className="text-xs text-primary hover:underline">
                  {t("productStudio.deliverables.openSprints")}
                </Link>
              ) : null}
            </li>
          ) : null}
          {!current.items.length && current.stage !== "DEVELOPMENT" ? <li className="text-sm text-muted-foreground">{t("productStudio.deliverables.none")}</li> : null}
        </ul>
      </section>
    </div>
  );
}
