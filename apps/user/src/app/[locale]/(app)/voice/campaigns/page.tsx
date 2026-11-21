import type { Metadata } from "next";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { EmptyState } from "@/components/comms/bits";
import { voicePage } from "@/components/voice/context";
import { CampaignForm, VoiceAction } from "@/components/voice/client";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { listCampaigns } from "@/server/modules/voice/campaigns";
import { toE164 } from "@/server/modules/voice/common";
import { listRuns } from "@/server/modules/voice/runs";
import { RunPlanner } from "@/components/voice/runs";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("voice.tabs.campaigns") };
}

const TONE = { DRAFT: "neutral", AWAITING_APPROVAL: "warning", RUNNING: "accent", PAUSED: "warning", COMPLETED: "success", CANCELLED: "neutral" } as const;

export default async function VoiceCampaignsPage() {
  const p = await voicePage("campaigns");
  if (p.gate) return p.gate;
  const { t, locale, viewer, org, company, tz, base, perms, wrap } = p;
  const scope = { organizationId: org.id, companyId: company.id };
  const [runs, campaigns, agents, numbers, leads, contacts] = await Promise.all([
    listRuns(viewer.ctx, org.id, company.id),
    listCampaigns(viewer.ctx, org.id, company.id),
    db().voiceAgent.findMany({ where: { ...scope, archivedAt: null, syncStatus: "SYNCED", goal: { not: "RECEPTIONIST" } }, select: { id: true, name: true, provider: true }, orderBy: { createdAt: "asc" } }),
    db().voicePhoneNumber.findMany({ where: { ...scope, releasedAt: null }, select: { id: true, number: true, label: true, provider: true } }),
    perms.post ? db().lead.findMany({ where: { ...scope, archivedAt: null, phone: { not: null }, stage: { notIn: ["WON", "LOST"] } }, orderBy: { updatedAt: "desc" }, take: 300, select: { id: true, name: true, phone: true, stage: true, account: true } }) : Promise.resolve([]),
    perms.post ? db().contact.findMany({ where: { ...scope, archivedAt: null, phone: { not: null } }, orderBy: { updatedAt: "desc" }, take: 300, select: { id: true, firstName: true, lastName: true, phone: true, title: true } }) : Promise.resolve([]),
  ]);
  const people = [
    ...leads.filter((l) => toE164(l.phone)).map((l) => ({ id: l.id, kind: "lead" as const, name: l.name, phone: toE164(l.phone)!, detail: [l.account, t(`voice.campaigns.stage.${l.stage}`)].filter(Boolean).join(" · ") || null })),
    ...contacts.filter((c) => toE164(c.phone)).map((c) => ({ id: c.id, kind: "contact" as const, name: [c.firstName, c.lastName].filter(Boolean).join(" "), phone: toE164(c.phone)!, detail: c.title })),
  ];
  const RUN_TONE = { PLANNED: "neutral", AWAITING_APPROVAL: "warning", RUNNING: "accent", COMPLETED: "success", CANCELLED: "neutral", FAILED: "danger" } as const;
  return wrap(
    <div className="grid gap-4">
      <Card>
        <CardHeader icon={<Megaphone />} title={t("voice.runs.title")} description={t("voice.runs.description")} />
        <CardBody className="grid gap-4">
          {runs.length ? (
            <ul className="grid gap-2">
              {runs.slice(0, 8).map((r) => {
                const s = r.stages;
                const called = (s.CALLING ?? 0) + (s.NO_ANSWER ?? 0) + (s.QUALIFIED ?? 0) + (s.NOT_QUALIFIED ?? 0) + (s.MEETING_BOOKED ?? 0) + (s.FAILED ?? 0);
                return (
                  <li key={r.id}>
                    <Link href={`/${locale}/voice/campaigns/runs/${r.id}`} className="grid gap-1 rounded-md border px-3 py-2.5 hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">{r.name} <Badge tone={RUN_TONE[r.status]}>{t(`voice.runs.status.${r.status}`)}</Badge></span>
                        <span className="block truncate text-xs text-muted-foreground">{r.goal}</span>
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {t("voice.runs.rowStats", { called, qualified: (s.QUALIFIED ?? 0) + (s.MEETING_BOOKED ?? 0), meetings: s.MEETING_BOOKED ?? 0 })} · {formatDateTime(r.createdAt, locale, tz)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {perms.post ? (
            <details className="rounded-md border" open={!runs.length}>
              <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium">{t("voice.runs.new")}</summary>
              <div className="border-t p-3">
                <RunPlanner base={base} locale={locale} agents={agents.map((a) => ({ id: a.id, name: a.name }))} />
              </div>
            </details>
          ) : null}
        </CardBody>
      </Card>
      {campaigns.length ? (
        <div className="grid gap-3">
          {campaigns.map((c) => {
            const progress = c.total ? Math.round(((c.done + c.skipped) / c.total) * 100) : 0;
            return (
              <Card key={c.id}>
                <CardBody className="grid gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {c.name} <Badge tone={TONE[c.status]}>{t(`voice.campaigns.status.${c.status}`)}</Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {c.agent.name} · <span className="font-mono">{c.number.number}</span> · {formatDateTime(c.createdAt, locale, tz)}
                      </p>
                    </div>
                    {perms.post ? (
                      <div className="flex flex-wrap gap-2">
                        {c.status === "RUNNING" ? <VoiceAction path={`${base}/voice/campaigns/${c.id}`} body={{ action: "pause" }} label={t("voice.campaigns.pause")} /> : null}
                        {c.status === "PAUSED" ? <VoiceAction path={`${base}/voice/campaigns/${c.id}`} body={{ action: "resume" }} label={t("voice.campaigns.resume")} /> : null}
                        {["AWAITING_APPROVAL", "RUNNING", "PAUSED", "DRAFT"].includes(c.status) ? <VoiceAction path={`${base}/voice/campaigns/${c.id}`} body={{ action: "cancel" }} label={t("voice.campaigns.cancel")} confirm={t("voice.campaigns.cancelConfirm")} variant="ghost" /> : null}
                        {c.status === "AWAITING_APPROVAL" ? <Link href={`/${locale}/approvals`} className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-muted">{t("voice.call.openApprovals")}</Link> : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="grid gap-1">
                    <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={t("voice.campaigns.progress")}>
                      <div className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${progress}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground">{t("voice.campaigns.counts", { total: c.total, done: c.done, pending: c.pending, skipped: c.skipped })}</p>
                  </div>
                  <Link href={`/${locale}/voice/calls?campaign=${c.id}`} className="text-sm font-medium text-primary hover:underline">{t("voice.campaigns.viewCalls")}</Link>
                </CardBody>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState>{t("voice.campaigns.empty")}</EmptyState>
      )}
      {perms.post ? (
        <Card>
          <CardHeader icon={<Megaphone />} title={t("voice.campaigns.new")} description={t("voice.campaigns.newHint")} />
          <CardBody>
            {agents.length && numbers.length ? (
              <CampaignForm base={base} agents={agents} numbers={numbers.map((n) => ({ id: n.id, name: n.label ? `${n.number} · ${n.label}` : n.number, provider: n.provider }))} people={people} />
            ) : (
              <Notice tone="info" action={<Link href={`/${locale}/voice/setup`} className="text-sm font-medium text-primary hover:underline">{t("voice.setup.continue")}</Link>}>{t("voice.campaigns.needSetup")}</Notice>
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>,
  );
}
