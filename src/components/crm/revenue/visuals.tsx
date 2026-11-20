import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarClock, CheckCircle2, CircleDashed, Mail, Radar, Sparkles } from "lucide-react";
import type { RevenueChannels } from "@/server/modules/crm/channels";
import { cn } from "@/lib/utils";

/** Server visuals of the revenue engine: provider checklist, priority orbit, editorial figures. */

export function Figure({ label, value, caption, href, tone }: { label: ReactNode; value: ReactNode; caption?: ReactNode; href?: string; tone?: "primary" | "warning" }) {
  const body = (
    <div className={cn("grid h-full gap-1 rounded-xl border bg-surface p-4 shadow-elev-1 transition-shadow", href ? "hover:shadow-elev-2" : "", tone === "primary" ? "border-primary/30" : tone === "warning" ? "border-warning/40" : "")}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-display text-3xl leading-none tabular-nums">{value}</p>
      {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Which providers power the engine right now — honest checklist with a link to connect the missing ones. */
export function EngineStatus({ channels, locale, t }: { channels: RevenueChannels; locale: string; t: (k: string, v?: Record<string, string | number>) => string }) {
  const rows = [
    { key: "research", icon: Radar, ok: channels.research.length > 0, detail: channels.research.join(", ") },
    { key: "ai", icon: Sparkles, ok: channels.aiText.length > 0, detail: channels.aiText.join(", ") },
    { key: "email", icon: Mail, ok: !!channels.mailbox || channels.sendgrid, detail: channels.mailbox ? channels.mailbox.address : channels.sendgrid ? "SendGrid" : "" },
    { key: "calendar", icon: CalendarClock, ok: !!channels.calendar, detail: channels.calendar ? t(`crm.rev.channels.${channels.calendar}`) : "" },
  ];
  return (
    <section className="grid gap-3 rounded-xl border bg-surface p-4 shadow-elev-1" aria-label={t("crm.rev.engine.title")}>
      <h2 className="font-display text-lg">{t("crm.rev.engine.title")}</h2>
      <ul className="grid gap-2">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start gap-2 text-sm">
            {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
            <span className="grid gap-0.5">
              <span className="font-medium">
                <r.icon className="me-1 inline size-3.5 align-[-2px]" aria-hidden />
                {t(`crm.rev.engine.${r.key}`)}
              </span>
              <span className="text-xs text-muted-foreground">{r.ok ? t("crm.rev.engine.on", { detail: r.detail }) : t(`crm.rev.engine.off.${r.key}`)}</span>
            </span>
          </li>
        ))}
      </ul>
      {rows.some((r) => !r.ok) ? (
        <Link href={`/${locale}/integrations`} className="text-sm font-medium text-primary underline">
          {t("crm.rev.connect")}
        </Link>
      ) : null}
    </section>
  );
}

/** Three rings — today / soon / later — with arc length proportional to the real number of suggested actions. */
export function PriorityOrbit({ counts, labels }: { counts: [number, number, number]; labels: [string, string, string] }) {
  const total = Math.max(1, counts[0] + counts[1] + counts[2]);
  const rings = [
    { r: 70, n: counts[0], color: "var(--danger)" },
    { r: 52, n: counts[1], color: "var(--warning)" },
    { r: 34, n: counts[2], color: "var(--primary)" },
  ];
  return (
    <figure className="flex items-center gap-4">
      <svg viewBox="0 0 160 160" className="size-36 shrink-0" role="img" aria-label={labels.map((l, i) => `${l}: ${counts[i]}`).join(", ")}>
        <defs>
          <radialGradient id="orbit-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="80" cy="80" r="26" fill="url(#orbit-core)" />
        {rings.map((ring, i) => {
          const len = 2 * Math.PI * ring.r;
          return (
            <g key={i}>
              <circle cx="80" cy="80" r={ring.r} fill="none" stroke="var(--border)" strokeWidth="8" />
              <circle
                cx="80"
                cy="80"
                r={ring.r}
                fill="none"
                stroke={ring.color}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${(ring.n / total) * len} ${len}`}
                transform="rotate(-90 80 80)"
                className="motion-safe:transition-[stroke-dasharray] motion-safe:duration-700"
              />
            </g>
          );
        })}
        <text x="80" y="86" textAnchor="middle" className="fill-foreground font-display text-[22px] tabular-nums">
          {counts[0] + counts[1] + counts[2]}
        </text>
      </svg>
      <figcaption className="grid gap-1.5 text-sm">
        {labels.map((l, i) => (
          <span key={l} className="flex items-center gap-2">
            <span aria-hidden className="size-2.5 rounded-full" style={{ background: rings[i]!.color }} />
            {l}
            <span className="font-semibold tabular-nums">{counts[i]}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
