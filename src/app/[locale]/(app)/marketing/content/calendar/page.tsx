import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { MarketingShell, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { contentCalendar } from "@/server/modules/marketing/content";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.content.calendar") };
}

/** Calendar day key of an instant in the company's time zone. */
function dayKey(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export default async function ContentCalendarPage({ searchParams }: PageProps<"/[locale]/marketing/content/calendar">) {
  const m = await loadMarketing();
  const { locale, t } = m;
  const back = { href: `/${locale}/marketing/content`, label: t("marketing.content.title") };
  const shell = { locale, t, tab: "content" as const, title: t("marketing.content.calendar"), back };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, tz } = m;
  const raw = (await searchParams).month;
  const monthStr = typeof raw === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : dayKey(new Date(), tz).slice(0, 7);
  const [y, mo] = monthStr.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  // Fetch with a day of margin on both sides; items are bucketed by company-local day.
  const data = await contentCalendar(viewer.ctx, org.id, company.id, new Date(first.getTime() - 86_400_000), new Date(Date.UTC(y, mo, 1) + 86_400_000));
  const byDay = new Map<string, { key: string; href: string; title: string; status: string; kind: string }[]>();
  const push = (d: Date | null, item: { key: string; href: string; title: string; status: string; kind: string }) => {
    if (!d) return;
    const k = dayKey(d, tz);
    byDay.set(k, [...(byDay.get(k) ?? []), item]);
  };
  for (const c of data.content) push(c.publishedAt ?? c.scheduledAt, { key: `c${c.id}`, href: `/${locale}/marketing/content/${c.id}`, title: c.title, status: c.status, kind: t(`marketing.contentType.${c.type}`) });
  for (const p of data.posts) push(p.publishedAt ?? p.scheduledAt, { key: `p${p.id}`, href: `/${locale}/marketing/social/${p.id}`, title: p.title, status: p.status, kind: t("marketing.social.post") });
  const offset = (first.getUTCDay() + 6) % 7; // Monday first
  const cells = [...Array.from({ length: offset }, () => null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const prev = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7);
  const weekdays = Array.from({ length: 7 }, (_, i) => formatDate(new Date(Date.UTC(2024, 0, 1 + i)), locale, "UTC", { weekday: "short" }));
  const today = dayKey(new Date(), tz);

  return (
    <MarketingShell {...shell}>
      <div className="flex items-center justify-between gap-2">
        <Link href={`?month=${prev}`} className="rounded-md border px-3 py-1 text-sm hover:bg-muted">
          ← {t("common.previous")}
        </Link>
        <h2 className="text-sm font-semibold">{formatDate(first, locale, "UTC", { month: "long", year: "numeric" })}</h2>
        <Link href={`?month=${next}`} className="rounded-md border px-3 py-1 text-sm hover:bg-muted">
          {t("common.next")} →
        </Link>
      </div>
      <Card className="overflow-x-auto">
        <div className="grid min-w-[720px] grid-cols-7">
          {weekdays.map((w) => (
            <div key={w} className="border-b px-2 py-1 text-xs font-medium text-muted-foreground">
              {w}
            </div>
          ))}
          {cells.map((d, i) => {
            const key = d ? `${monthStr}-${String(d).padStart(2, "0")}` : `x${i}`;
            const items = d ? (byDay.get(key) ?? []) : [];
            return (
              <div key={key} className={`min-h-28 border-b border-e p-1 ${d ? "" : "bg-surface-2"}`}>
                {d ? <div className={`mb-1 text-xs ${key === today ? "font-semibold text-primary" : "text-muted-foreground"}`}>{d}</div> : null}
                <ul className="grid gap-1">
                  {items.map((it) => (
                    <li key={it.key}>
                      <Link href={it.href} className="grid gap-0.5 rounded-sm border bg-surface p-1 text-[11px] hover:bg-muted">
                        <span className="truncate font-medium">{it.title}</span>
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <StatusBadge status={it.status} label={it.kind} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Card>
      {data.content.length + data.posts.length === 0 ? <p className="text-sm text-muted-foreground">{t("marketing.content.calendarEmpty")}</p> : null}
    </MarketingShell>
  );
}
