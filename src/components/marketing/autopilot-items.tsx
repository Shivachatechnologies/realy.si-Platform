import Link from "next/link";
import { Check, RotateCcw, Sparkles, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Translate } from "@/i18n/translate";
import { formatDateTime } from "@/i18n/format";
import type { listItems } from "@/server/modules/marketing/autopilot";
import { ActionButton } from "./ui";
import { StatusBadge } from "./status-badge";
import { PlatformPreview } from "./studio";
import { ItemEditor } from "./studio-forms";
import { Pop } from "./studio-client";

const STAGE_TONE: Record<string, string> = { READY: "APPROVED", SCHEDULED: "SCHEDULED", PUBLISHED: "PUBLISHED", ANALYZED: "COMPLETED", REJECTED: "CANCELLED", FAILED: "FAILED", AI_REVIEW: "IN_REVIEW" };

type Items = Awaited<ReturnType<typeof listItems>>["data"];

/** Content canvas of pipeline items: platform-accurate previews, review results and the actions each stage allows. */
export function ItemsCanvas({ items, t, locale, tz, base, brand, canManage }: { items: Items; t: Translate; locale: string; tz: string; base: string; brand: string; canManage: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((it, i) => {
        const review = (it.review ?? null) as { score?: number; passed?: boolean; auto?: { check: string; severity: string; message: string }[]; checks?: Record<string, { pass: boolean; note?: string }>; issues?: string[] } | null;
        const editable = !["SCHEDULED", "PUBLISHED", "ANALYZED"].includes(it.stage);
        const perf = it.performance as { impressions?: number; engagement?: number; engagementRate?: number | null } | null;
        return (
          <Pop key={it.id} i={i}>
            <Card variant={it.stage === "READY" && it.needsApproval ? "highlight" : "default"} className="grid h-full content-start gap-3 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5">
                  <StatusBadge status={STAGE_TONE[it.stage] ?? "DRAFT"} label={t(`marketing.studio.stage.${it.stage}`)} />
                  <Badge>{t(`marketing.provider.${it.platform}`)}</Badge>
                  {it.format !== "post" ? <Badge tone="info">{t(`marketing.studio.format.${it.format}`)}</Badge> : null}
                </span>
                <time className="text-muted-foreground">{formatDateTime(it.slotAt, locale, tz)}</time>
              </div>
              {it.topic ? <p className="text-sm font-medium">{it.topic}</p> : <p className="text-sm text-muted-foreground">{t("marketing.studio.item.noTopic")}</p>}
              {it.copy ? (
                <PlatformPreview platform={it.platform} brand={brand} text={it.copy} hashtags={it.hashtags} mediaUrl={it.asset?.publicUrl ?? null} video={it.asset?.kind === "VIDEO"} t={t} />
              ) : it.pendingTaskId ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Sparkles className="size-3.5 animate-pulse text-primary" aria-hidden />
                  {t(`marketing.studio.item.working.${it.pendingStep ?? "draft"}`)}{" "}
                  <Link className="underline" href={`/${locale}/tasks/${it.pendingTaskId}`}>
                    {t("marketing.studio.item.viewTask")}
                  </Link>
                </p>
              ) : null}
              {it.asset?.status === "PROCESSING" ? <p className="text-xs text-muted-foreground">{t("marketing.studio.item.videoProcessing")}</p> : null}
              {review?.score != null ? (
                <details className="rounded-md bg-surface-2 p-2 text-xs">
                  <summary className="cursor-pointer">
                    {t("marketing.studio.item.review", { score: review.score })} {review.passed ? "✓" : "✗"}
                  </summary>
                  <ul className="mt-2 grid gap-1">
                    {Object.entries(review.checks ?? {}).map(([k, v]) => (
                      <li key={k} className={v.pass ? "text-success" : "text-danger"}>
                        {v.pass ? "✓" : "✗"} {t(`marketing.studio.check.${k}`)}
                        {v.note ? ` — ${v.note}` : ""}
                      </li>
                    ))}
                    {(review.auto ?? []).map((a, j) => (
                      <li key={j} className={a.severity === "error" ? "text-danger" : "text-warning"}>
                        • {a.message}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {it.assumptions ? <p className="text-[11px] text-muted-foreground">{t("marketing.studio.item.assumptions")}: {it.assumptions}</p> : null}
              {Array.isArray(it.sources) && (it.sources as { title: string; url: string }[]).length ? (
                <details className="text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer">{t("marketing.studio.item.sources", { count: (it.sources as unknown[]).length })}</summary>
                  <ul className="mt-1 grid gap-0.5">
                    {(it.sources as { title: string; url: string }[]).map((s) => (
                      <li key={s.url} className="truncate">
                        <a href={s.url} target="_blank" rel="noreferrer noopener" className="underline">
                          {s.title || s.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {it.videoScript ? (
                <details className="text-xs">
                  <summary className="cursor-pointer">{t("marketing.studio.item.videoScript")}</summary>
                  <pre className="mt-1 whitespace-pre-wrap font-sans">{it.videoScript}</pre>
                </details>
              ) : null}
              {it.error ? <p className="text-xs text-danger">{t("marketing.studio.item.error")}: {it.error}</p> : null}
              {perf ? <p className="text-xs text-muted-foreground">{t("marketing.studio.item.performance", { impressions: perf.impressions ?? 0, engagement: perf.engagement ?? 0 })}</p> : null}
              {it.postId ? (
                <Link href={`/${locale}/marketing/social/${it.postId}`} className="text-xs underline">
                  {t("marketing.studio.item.openPost")}
                </Link>
              ) : null}
              {canManage ? (
                <div className="mt-auto flex flex-wrap gap-1 border-t pt-2">
                  {it.stage === "READY" && it.copy && (it.needsApproval || !it.approvedAt) ? <ActionButton path={`${base}/autopilot-items/${it.id}/actions`} body={{ action: "approve" }} icon={<Check aria-hidden />} label={t("marketing.studio.item.approve")} variant="default" /> : null}
                  {editable && it.stage !== "REJECTED" ? <ActionButton path={`${base}/autopilot-items/${it.id}/actions`} body={{ action: "reject" }} icon={<X aria-hidden />} label={t("marketing.studio.item.reject")} variant="ghost" /> : null}
                  {it.stage === "FAILED" || it.stage === "REJECTED" ? <ActionButton path={`${base}/autopilot-items/${it.id}/actions`} body={{ action: "retry" }} icon={<RotateCcw aria-hidden />} label={t("marketing.studio.item.retry")} /> : null}
                  {editable && it.copy ? <ActionButton path={`${base}/autopilot-items/${it.id}/actions`} body={{ action: "regenerate" }} icon={<Sparkles aria-hidden />} label={t("marketing.studio.item.regenerate")} variant="ghost" /> : null}
                </div>
              ) : null}
              {canManage && editable && it.copy ? (
                <details className="text-xs">
                  <summary className="cursor-pointer">{t("marketing.studio.item.edit")}</summary>
                  <div className="mt-2">
                    <ItemEditor base={base} item={it} />
                  </div>
                </details>
              ) : null}
            </Card>
          </Pop>
        );
      })}
    </div>
  );
}
