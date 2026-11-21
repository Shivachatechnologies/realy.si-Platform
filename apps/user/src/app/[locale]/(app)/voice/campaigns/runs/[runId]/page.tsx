import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { voicePage } from "@/components/voice/context";
import { RunActions } from "@/components/voice/runs";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { getRun, runReport } from "@/server/modules/voice/runs";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("voice.runs.title") };
}

const RUN_TONE = { PLANNED: "neutral", AWAITING_APPROVAL: "warning", RUNNING: "accent", COMPLETED: "success", CANCELLED: "neutral", FAILED: "danger" } as const;
const TARGET_TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "danger" | "info"> = { ELIGIBLE: "info", SKIPPED: "neutral", SCHEDULED: "info", CALLING: "accent", NO_ANSWER: "neutral", QUALIFIED: "success", NOT_QUALIFIED: "neutral", MEETING_BOOKED: "success", FAILED: "danger" };
const PIPELINE = ["eligibility", "prioritize", "brief", "execute", "qualify", "book", "crm", "followups", "report"] as const;

/** One autonomous calling run: pipeline, eligibility, funnel, per-lead targets with briefs, and the final report. */
export default async function VoiceRunPage({ params }: PageProps<"/[locale]/voice/campaigns/runs/[runId]">) {
  const { runId } = await params;
  const p = await voicePage("campaigns");
  if (p.gate) return p.gate;
  const { t, locale, viewer, org, company, tz, base, perms, wrap } = p;
  const run = await getRun(viewer.ctx, org.id, company.id, runId).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const report = await runReport(org.id, company.id, runId);
  const elig = (run.eligibility ?? {}) as { considered?: number; eligible?: number; skipped?: Record<string, number> };
  const skipped = Object.entries(elig.skipped ?? {}).sort((a, b) => b[1] - a[1]);
  const people = run.targets.filter((x) => x.status === "ELIGIBLE").length;
  const step = run.status === "PLANNED" || run.status === "AWAITING_APPROVAL" ? 3 : run.status === "RUNNING" ? 6 : run.status === "COMPLETED" ? 9 : 3;
  const funnel = [
    { key: "considered", value: elig.considered ?? 0 },
    { key: "eligible", value: elig.eligible ?? 0 },
    { key: "placed", value: report.placed },
    { key: "connected", value: report.connected },
    { key: "conversations", value: report.conversations },
    { key: "qualified", value: report.qualified },
    { key: "meetings", value: report.meetings },
  ];
  const max = Math.max(1, ...funnel.map((f) => f.value));
  return wrap(
    <div className="grid gap-4">
      <Link href={`/${locale}/voice/campaigns`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" /> {t("voice.runs.back")}
      </Link>
      <Card>
        <CardHeader
          title={<span className="flex flex-wrap items-center gap-2">{run.name}<Badge tone={RUN_TONE[run.status]}>{t(`voice.runs.status.${run.status}`)}</Badge></span>}
          description={`${run.goal} · ${run.agent?.name ?? "—"} · ${formatDateTime(run.createdAt, locale, tz)}`}
        />
        <CardBody className="grid gap-4">
          <p className="text-sm"><span className="text-muted-foreground">{t("voice.runs.purpose")}: </span>{run.purpose}</p>
          <ol className="flex flex-wrap gap-1.5" aria-label={t("voice.runs.pipeline")}>
            {PIPELINE.map((k, i) => (
              <li key={k} className={i < step ? "rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground" : "rounded-full border px-2.5 py-1 text-xs text-muted-foreground"}>
                {i + 1}. {t(`voice.runs.steps.${k}`)}
              </li>
            ))}
          </ol>
          {run.status === "AWAITING_APPROVAL" ? (
            <Notice tone="warning" action={<Link href={`/${locale}/approvals`} className="text-sm font-medium text-primary hover:underline">{t("voice.call.openApprovals")}</Link>}>{t("voice.runs.awaiting")}</Notice>
          ) : null}
          {run.summary ? <Notice tone={run.status === "COMPLETED" ? "success" : "info"}>{run.summary}</Notice> : null}
          <RunActions base={base} runId={run.id} status={run.status} canPost={perms.post} people={people} />
        </CardBody>
      </Card>

      <StatGrid>
        <StatTile index={0} label={t("voice.funnel.connectRate")} value={report.connectRate !== null ? `${report.connectRate}%` : "—"} hint={t("voice.funnel.connectedOf", { connected: report.connected, placed: report.placed })} />
        <StatTile index={1} label={t("voice.funnel.qualified")} value={report.qualified} />
        <StatTile index={2} label={t("voice.funnel.meetings")} value={report.meetings} hint={t("voice.funnel.followUps", { count: report.followUps })} />
        <StatTile index={3} label={t("voice.funnel.costPerMeeting")} value={report.costPerMeetingMinor === null ? "—" : undefined} money={report.costPerMeetingMinor !== null ? { amountMinor: report.costPerMeetingMinor, currency: report.currency } : undefined} hint={t("voice.funnel.totalCost")} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("voice.funnel.title")} description={t("voice.funnel.runHint")} />
          <CardBody>
            <ul className="grid gap-2">
              {funnel.map((f) => (
                <li key={f.key} className="grid grid-cols-[8.5rem_minmax(0,1fr)_3rem] items-center gap-3 text-sm">
                  <span className="truncate">{t(`voice.funnel.stages.${f.key}`)}</span>
                  <span className="h-3 rounded-e-[4px] bg-muted"><span className="block h-full rounded-e-[4px] bg-primary" style={{ width: `${(f.value / max) * 100}%` }} /></span>
                  <span className="text-end tabular-nums text-muted-foreground">{f.value}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("voice.runs.eligibility")} description={t("voice.runs.eligibilityHint", { considered: elig.considered ?? 0, eligible: elig.eligible ?? 0 })} />
          <CardBody>
            {skipped.length ? (
              <ul className="grid gap-1.5 text-sm">
                {skipped.map(([reason, n]) => (
                  <li key={reason} className="flex items-center justify-between gap-2">
                    <span>{t(`voice.runs.skip.${reason}`)}</span>
                    <span className="tabular-nums text-muted-foreground">{n}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("voice.runs.noneSkipped")}</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={t("voice.runs.targets")} description={t("voice.runs.targetsHint")} />
        {run.targets.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t("voice.runs.person")}</Th>
                <Th className="hidden sm:table-cell">{t("voice.runs.priority")}</Th>
                <Th>{t("common.status")}</Th>
                <Th className="hidden lg:table-cell">{t("voice.runs.brief")}</Th>
              </Tr>
            </THead>
            <TBody>
              {run.targets.slice(0, 300).map((x) => (
                <Tr key={x.id}>
                  <Td>
                    {x.leadId ? <Link href={`/${locale}/crm/${x.leadId}`} className="font-medium hover:underline">{x.name}</Link> : <span className="font-medium">{x.name}</span>}
                    <span className="block text-xs text-muted-foreground">{x.phone ?? "—"}</span>
                  </Td>
                  <Td className="hidden sm:table-cell tabular-nums">{x.status === "SKIPPED" ? "—" : x.priority}</Td>
                  <Td>
                    <Badge tone={TARGET_TONE[x.status] ?? "neutral"}>{t(`voice.runs.targetStatus.${x.status}`)}</Badge>
                    {x.skipReason ? <span className="block text-xs text-muted-foreground">{t(`voice.runs.skip.${x.skipReason}`)}</span> : null}
                    {x.callId ? <Link href={`/${locale}/voice/calls/${x.callId}`} className="block text-xs text-primary hover:underline">{t("voice.runs.openCall")}</Link> : null}
                  </Td>
                  <Td className="hidden max-w-md lg:table-cell">
                    {x.brief ? (
                      <details>
                        <summary className="cursor-pointer truncate text-xs text-muted-foreground">{x.brief.split("\n")[0]}</summary>
                        <pre className="mt-1 whitespace-pre-wrap font-sans text-xs">{x.brief}</pre>
                      </details>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("voice.runs.noTargets")}</p>
        )}
      </Card>
    </div>,
  );
}
