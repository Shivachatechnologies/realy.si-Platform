import type { Metadata } from "next";
import Link from "next/link";
import { CheckSquare, Mail } from "lucide-react";
import { CrmFrame, crmContext } from "@/components/crm/shell";
import { SequenceEditor } from "@/components/crm/revenue/sequences";
import { Badge } from "@/components/ui/badge";
import { getT } from "@/i18n/server";
import { listCadences } from "@/server/modules/crm/cadences";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.tabs.sequences") };
}

const STATUS_TONE = { DRAFT: "neutral", ACTIVE: "success", PAUSED: "warning", ARCHIVED: "neutral" } as const;

/** Sequences: automatic follow-ups that run on a schedule and stop when the person replies. */
export default async function SequencesPage() {
  const c = await crmContext();
  if (!c.company || !c.canRead) return <CrmFrame active="sequences">{null}</CrmFrame>;
  const { t, locale, org, company, viewer, base } = c;
  const sequences = await listCadences(viewer.ctx, org.id, company.id);
  return (
    <CrmFrame active="sequences" eyebrow={t("crm.rev.seq.eyebrow")} title={t("crm.rev.seq.title")} subtitle={t("crm.rev.seq.subtitle")}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="grid content-start gap-3" aria-labelledby="seq-h">
          <h2 id="seq-h" className="font-display text-2xl">{t("crm.rev.seq.yours")}</h2>
          {sequences.length ? (
            <ul className="grid gap-3">
              {sequences.map((s) => (
                <li key={s.id}>
                  <Link href={`/${locale}/crm/sequences/${s.id}`} className="grid gap-2 rounded-xl border bg-surface p-4 shadow-elev-1 transition-shadow hover:shadow-elev-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{s.name}</span>
                      <Badge tone={STATUS_TONE[s.status]}>{t(`crm.rev.seq.status.${s.status}`)}</Badge>
                      {s.status === "ACTIVE" ? <Badge tone={s.autoSend ? "info" : "neutral"}>{t(s.autoSend ? "crm.rev.seq.autoBadge" : "crm.rev.seq.reviewBadge")}</Badge> : null}
                    </span>
                    {/* Step strip: one dot per step, spaced by its waiting days. */}
                    <span className="flex items-center gap-1" aria-label={t("crm.rev.seq.stepsCount", { count: s.steps.length })}>
                      {s.steps.map((st, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 ? <span aria-hidden className="h-px bg-border" style={{ width: `${Math.min(48, 6 + st.delayDays * 4)}px` }} /> : null}
                          <span className="grid size-6 place-items-center rounded-full bg-accent text-accent-foreground" title={t("crm.rev.seq.dayN", { day: st.delayDays })}>
                            {st.kind === "EMAIL" ? <Mail className="size-3" aria-hidden /> : <CheckSquare className="size-3" aria-hidden />}
                          </span>
                        </span>
                      ))}
                    </span>
                    <span className="text-xs text-muted-foreground">{t("crm.rev.seq.listMeta", { active: s.active, replied: s.replied, completed: s.completed })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{t("crm.rev.seq.empty")}</p>
          )}
        </section>
        {c.canManage ? (
          <section className="grid content-start gap-3 rounded-xl border bg-surface p-4 shadow-elev-1" aria-labelledby="new-seq-h">
            <h2 id="new-seq-h" className="font-display text-2xl">{t("crm.rev.seq.new")}</h2>
            <p className="text-sm text-muted-foreground">{t("crm.rev.seq.newHint")}</p>
            <SequenceEditor base={base} locale={locale} />
          </section>
        ) : null}
      </div>
    </CrmFrame>
  );
}
