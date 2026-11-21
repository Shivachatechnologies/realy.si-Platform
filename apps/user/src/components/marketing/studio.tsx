import type { ReactNode } from "react";
import Link from "next/link";
import { Compass, Heart, MessageCircle, Repeat2, Send, Share2, ThumbsUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Translate } from "@/i18n/translate";
import { AiTaskList, type AiTaskRow } from "./ai-tasks";
import { HelpButton } from "./studio-client";

/**
 * Marketing Studio building blocks (server-safe): the "what / why / do / next" strip, smart empty states,
 * platform-accurate post previews, the pipeline status board and small SVG charts. All render real data only.
 */

export function InfoStrip({ t, k, next, help }: { t: Translate; k: string; next?: ReactNode; help?: ReactNode }) {
  return (
    <Card variant="glass" className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center">
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-[11px] font-semibold tracking-wide text-primary uppercase">{t("marketing.studio.strip.what")}</dt>
          <dd className="text-muted-foreground">{t(`marketing.studio.pages.${k}.what`)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold tracking-wide text-primary uppercase">{t("marketing.studio.strip.why")}</dt>
          <dd className="text-muted-foreground">{t(`marketing.studio.pages.${k}.why`)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold tracking-wide text-primary uppercase">{t("marketing.studio.strip.do")}</dt>
          <dd className="text-muted-foreground">{t(`marketing.studio.pages.${k}.do`)}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        {next}
        {help}
      </div>
    </Card>
  );
}

/** Never-blank empty state: what this is, a working create action and "let AI do it". */
export function SmartEmpty({ icon, title, body, action, ai }: { icon?: ReactNode; title: string; body: string; action?: ReactNode; ai?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-3 rounded-lg border border-dashed p-8 text-center">
      {icon ? <span className="grid size-11 place-items-center rounded-full bg-accent text-accent-foreground [&_svg]:size-5">{icon}</span> : null}
      <div className="grid max-w-md gap-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {action}
        {ai}
      </div>
    </div>
  );
}

/** Help panel: the button plus the latest help tasks with live status and output. */
export function HelpPanel({ t, base, page, tasks, locale, tz, aiReady, canRun, context }: { t: Translate; base: string; page: string; tasks: AiTaskRow[]; locale: string; tz: string; aiReady: boolean; canRun: boolean; context?: string }) {
  if (!tasks.length && !canRun) return null;
  return (
    <details className="rounded-lg border bg-surface p-3" open={tasks.some((x) => x.status === "QUEUED" || x.status === "RUNNING")}>
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <Compass className="size-4 text-primary" aria-hidden />
        {t("marketing.studio.help.title")}
      </summary>
      <div className="mt-3 grid gap-3">
        {canRun ? <HelpButton base={base} page={page} context={context} /> : null}
        <AiTaskList tasks={tasks} locale={locale} tz={tz} t={t} aiReady={aiReady} />
      </div>
    </details>
  );
}

// ── Platform-accurate previews ──

export const PREVIEW_PLATFORMS = ["LINKEDIN", "X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK", "THREADS", "PINTEREST"] as const;
type PreviewPlatform = (typeof PREVIEW_PLATFORMS)[number];

const CONTENT_TO_PLATFORM: Record<string, PreviewPlatform> = { LINKEDIN: "LINKEDIN", X: "X", INSTAGRAM: "INSTAGRAM", FACEBOOK: "FACEBOOK", YOUTUBE_SCRIPT: "YOUTUBE", TIKTOK_SCRIPT: "TIKTOK", THREADS: "THREADS", CAROUSEL: "INSTAGRAM" };
export const platformForContent = (type: string): PreviewPlatform | null => CONTENT_TO_PLATFORM[type] ?? null;

function Avatar({ name }: { name: string }) {
  return <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-gradient text-xs font-semibold text-primary-foreground">{name.slice(0, 2).toUpperCase()}</span>;
}

function Media({ url, video, ratio }: { url: string | null | undefined; video?: boolean; ratio: string }) {
  if (!url) return null;
  return (
    <div className="overflow-hidden bg-muted" style={{ aspectRatio: ratio }}>
      {video ? (
        <video src={url} className="size-full object-cover" muted playsInline controls preload="metadata" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- signed asset URLs / provider CDNs
        <img src={url} alt="" className="size-full object-cover" loading="lazy" />
      )}
    </div>
  );
}

/** A social post rendered the way the platform shows it (typography, chrome, crop). */
export function PlatformPreview({ platform, brand, text, hashtags = [], mediaUrl, video, t, handle }: { platform: PreviewPlatform; brand: string; text: string; hashtags?: string[]; mediaUrl?: string | null; video?: boolean; t: Translate; handle?: string | null }) {
  const body = hashtags.length ? `${text}\n\n${hashtags.join(" ")}` : text;
  const at = handle ?? `@${brand.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  const clamp = (n: number) => (body.length > n ? `${body.slice(0, n)}… ` : body);
  const label = t(`marketing.provider.${platform}`);
  if (platform === "X" || platform === "THREADS") {
    return (
      <article aria-label={label} className="rounded-xl border bg-surface p-3 text-sm">
        <div className="flex gap-2">
          <Avatar name={brand} />
          <div className="min-w-0 flex-1">
            <p className="truncate">
              <span className="font-semibold">{brand}</span> <span className="text-muted-foreground">{at} · 1m</span>
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words">{body}</p>
            {mediaUrl ? <div className="mt-2 overflow-hidden rounded-xl border"><Media url={mediaUrl} video={video} ratio="16/9" /></div> : null}
            <div className="mt-2 flex justify-between text-muted-foreground" aria-hidden>
              <MessageCircle className="size-4" />
              <Repeat2 className="size-4" />
              <Heart className="size-4" />
              <Share2 className="size-4" />
            </div>
          </div>
        </div>
      </article>
    );
  }
  if (platform === "INSTAGRAM" || platform === "PINTEREST") {
    return (
      <article aria-label={label} className="overflow-hidden rounded-xl border bg-surface text-sm">
        <div className="flex items-center gap-2 p-2.5">
          <Avatar name={brand} />
          <span className="font-semibold">{at.replace("@", "")}</span>
        </div>
        {mediaUrl ? <Media url={mediaUrl} video={video} ratio={platform === "PINTEREST" ? "2/3" : "4/5"} /> : <div className="grid aspect-[4/5] place-items-center bg-muted p-6 text-center text-xs text-muted-foreground">{t("marketing.studio.preview.needsMedia")}</div>}
        <div className="flex gap-3 p-2.5 pb-0" aria-hidden>
          <Heart className="size-5" />
          <MessageCircle className="size-5" />
          <Send className="size-5" />
        </div>
        <p className="whitespace-pre-wrap break-words p-2.5">
          <span className="font-semibold">{at.replace("@", "")}</span> {clamp(300)}
        </p>
      </article>
    );
  }
  if (platform === "TIKTOK" || platform === "YOUTUBE") {
    const vertical = platform === "TIKTOK";
    return (
      <article aria-label={label} className={`relative overflow-hidden rounded-xl border bg-black text-white ${vertical ? "mx-auto aspect-[9/16] max-w-[260px]" : "aspect-video"}`}>
        {mediaUrl ? (
          <Media url={mediaUrl} video={video} ratio={vertical ? "9/16" : "16/9"} />
        ) : (
          <div className="grid size-full place-items-center p-6 text-center text-xs text-white/70">{t("marketing.studio.preview.needsVideo")}</div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 text-xs">
          <p className="font-semibold">{at}</p>
          <p className="line-clamp-3 whitespace-pre-wrap">{body}</p>
        </div>
      </article>
    );
  }
  // LinkedIn / Facebook
  return (
    <article aria-label={label} className="overflow-hidden rounded-xl border bg-surface text-sm">
      <div className="flex gap-2 p-3">
        <Avatar name={brand} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{brand}</p>
          <p className="text-xs text-muted-foreground">{platform === "LINKEDIN" ? t("marketing.studio.preview.followers") : t("marketing.studio.preview.justNow")}</p>
        </div>
      </div>
      <p className="whitespace-pre-wrap break-words px-3 pb-3">{clamp(platform === "LINKEDIN" ? 210 : 480)}</p>
      <Media url={mediaUrl} video={video} ratio={platform === "LINKEDIN" ? "1.91/1" : "1.91/1"} />
      <div className="flex justify-around border-t p-2 text-xs text-muted-foreground" aria-hidden>
        <ThumbsUp className="size-4" />
        <MessageCircle className="size-4" />
        <Share2 className="size-4" />
      </div>
    </article>
  );
}

// ── Charts (real data; accessible) ──

export function BarChart({ data, label, format = (v) => String(v) }: { data: { label: string; value: number }[]; label: string; format?: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return null;
  return (
    <figure className="grid gap-2" aria-label={label}>
      <ul className="grid gap-1.5">
        {data.map((d) => (
          <li key={d.label} className="grid grid-cols-[7rem_1fr_auto] items-center gap-2 text-xs">
            <span className="truncate text-muted-foreground">{d.label}</span>
            <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2.5 w-full" role="img" aria-label={`${d.label}: ${format(d.value)}`}>
              <rect x="0" y="0" width="100" height="8" rx="4" className="fill-muted" />
              <rect x="0" y="0" width={(d.value / max) * 100} height="8" rx="4" className="fill-primary transition-[width] duration-700 motion-reduce:transition-none" />
            </svg>
            <span className="tabular-nums">{format(d.value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Pipeline status board: one column per stage with counts and links. */
export function StageBoard({ t, counts, href, stages }: { t: Translate; counts: Partial<Record<string, number>>; href: (stage: string) => string; stages: readonly string[] }) {
  return (
    <ol className="stagger grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-10" aria-label={t("marketing.studio.pipeline.title")}>
      {stages.map((s) => (
        <li key={s}>
          <Link href={href(s)} className="hover-lift grid gap-1 rounded-md border bg-surface p-2 text-center">
            <span className="text-lg font-semibold tabular-nums">{counts[s] ?? 0}</span>
            <span className="truncate text-[11px] text-muted-foreground">{t(`marketing.studio.stage.${s}`)}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
