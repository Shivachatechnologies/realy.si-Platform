import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { voicePage } from "@/components/voice/context";
import { VoiceAction } from "@/components/voice/client";
import { TranscriptViewer, type TranscriptLine } from "@/components/voice/transcript";
import { formatDuration, isLive, OUTCOME_TONE, SENTIMENT_TONE, STATUS_TONE } from "@/components/voice/bits";
import { getT } from "@/i18n/server";
import { formatDateTime, formatMoney } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { getCall } from "@/server/modules/voice/calls";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("voice.call.title") };
}

const ANALYSIS_KEYS = ["caller_name", "caller_email", "caller_company", "meeting_time", "callback_time", "follow_up_note", "support_issue", "urgency", "payment_promise_date", "message_for_team"] as const;

export default async function VoiceCallPage({ params }: PageProps<"/[locale]/voice/calls/[callId]">) {
  const { callId } = await params;
  const p = await voicePage("calls");
  if (p.gate) return p.gate;
  const { t, locale, viewer, org, company, tz, base, perms, wrap } = p;
  const call = await getCall(viewer.ctx, org.id, company.id, callId).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const transcript = (Array.isArray(call.transcript) ? call.transcript : []) as unknown as TranscriptLine[];
  const analysis = (call.analysis && typeof call.analysis === "object" && !Array.isArray(call.analysis) ? call.analysis : {}) as Record<string, unknown>;
  const results = (Array.isArray(call.results) ? call.results : []) as unknown as { type: string; id: string; label: string; href?: string }[];
  const person = call.subjectName ?? (call.direction === "INBOUND" ? call.fromNumber : call.toNumber) ?? t("voice.calls.unknown");
  const subjectHref = call.leadId ? `/${locale}/crm/${call.leadId}` : call.contactId ? `/${locale}/crm/contacts/${call.contactId}` : null;
  return wrap(
    <div className="grid gap-4">
      <Link href={`/${locale}/voice/calls`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" /> {t("voice.call.back")}
      </Link>
      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              {subjectHref ? <Link href={subjectHref} className="hover:underline">{person}</Link> : person}
              <Badge tone={STATUS_TONE[call.status] ?? "neutral"} pulse={isLive(call.status)}>{t(`voice.status.${call.status}`)}</Badge>
              {call.outcome ? <Badge tone={OUTCOME_TONE[call.outcome] ?? "neutral"}>{t(`voice.outcomes.${call.outcome}`)}</Badge> : null}
              {call.sentiment ? <Badge tone={SENTIMENT_TONE[call.sentiment] ?? "neutral"}>{t(`voice.sentiment.${call.sentiment}`)}</Badge> : null}
            </span>
          }
          description={t(`voice.direction.${call.direction}`)}
          actions={
            perms.post && (call.status === "AWAITING_APPROVAL" || call.status === "SCHEDULED") ? (
              <VoiceAction path={`${base}/voice/calls/${call.id}/cancel`} label={t("voice.call.cancel")} confirm={t("voice.call.cancelConfirm")} variant="ghost" />
            ) : undefined
          }
        />
        <CardBody>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-xs text-muted-foreground">{t("voice.calls.agent")}</dt><dd>{call.agent ? <Link className="hover:underline" href={`/${locale}/voice/agents/${call.agent.id}`}>{call.agent.name}</Link> : "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("voice.call.numbers")}</dt><dd className="font-mono text-xs">{call.fromNumber ?? "—"} → {call.toNumber}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("voice.calls.when")}</dt><dd>{formatDateTime(call.startedAt ?? call.createdAt, locale, tz)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("voice.calls.duration")}</dt><dd className="tabular-nums">{call.durationSec ? formatDuration(call.durationSec) : "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("voice.call.cost")}</dt><dd>{call.costMinor !== null ? formatMoney({ amountMinor: call.costMinor, currency: call.costCurrency }, locale) : "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("voice.call.requestedBy")}</dt><dd>{call.requesterName ?? (call.direction === "INBOUND" ? t("voice.call.inboundCaller") : "—")}</dd></div>
            {call.campaign ? <div><dt className="text-xs text-muted-foreground">{t("voice.call.campaign")}</dt><dd><Link className="hover:underline" href={`/${locale}/voice/campaigns`}>{call.campaign.name}</Link></dd></div> : null}
            {call.endedReason ? <div><dt className="text-xs text-muted-foreground">{t("voice.call.endedReason")}</dt><dd className="font-mono text-xs">{call.endedReason}</dd></div> : null}
          </dl>
          {call.purpose ? <p className="mt-4 text-sm"><span className="text-muted-foreground">{t("voice.call.purpose")}: </span>{call.purpose}</p> : null}
        </CardBody>
      </Card>
      {call.status === "AWAITING_APPROVAL" ? (
        <Notice tone="warning" title={t("voice.call.awaitingTitle")} action={<Link href={`/${locale}/approvals`} className="text-sm font-medium text-primary hover:underline">{t("voice.call.openApprovals")}</Link>}>
          {t("voice.call.awaitingBody")}
        </Notice>
      ) : null}
      {call.status === "SCHEDULED" && call.scheduledFor ? <Notice tone="info">{t("voice.call.scheduledFor", { when: formatDateTime(call.scheduledFor, locale, tz) })}</Notice> : null}
      {call.blockedReason && ["BLOCKED", "CANCELLED", "REJECTED"].includes(call.status) ? <Notice tone="warning">{t(`voice.blocked.${call.blockedReason}`)}</Notice> : null}
      {call.error ? <Notice tone="danger" title={t("voice.call.failed")}>{call.error}</Notice> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t("voice.call.transcript")} description={call.recordingUrl ? t("voice.call.recordingHint") : undefined} actions={call.recordingUrl ? <a href={call.recordingUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">{t("voice.call.onProvider")} <ExternalLink aria-hidden className="size-3" /></a> : undefined} />
          <CardBody>
            {transcript.length ? (
              <TranscriptViewer lines={transcript} recordingSrc={call.recordingUrl ? `${base}/voice/calls/${call.id}/recording` : null} agentName={call.agent?.name ?? t("voice.call.ai")} />
            ) : (
              <p className="text-sm text-muted-foreground">{isLive(call.status) ? t("voice.call.transcriptLive") : t("voice.call.noTranscript")}</p>
            )}
          </CardBody>
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("voice.call.summary")} />
            <CardBody className="grid gap-3 text-sm">
              <p className={call.summary ? "leading-relaxed" : "text-muted-foreground"}>{call.summary ?? t("voice.call.noSummary")}</p>
              {ANALYSIS_KEYS.some((k) => typeof analysis[k] === "string" && analysis[k]) ? (
                <dl className="grid gap-2 border-t pt-3">
                  {ANALYSIS_KEYS.filter((k) => typeof analysis[k] === "string" && analysis[k]).map((k) => (
                    <div key={k} className="grid gap-0.5">
                      <dt className="text-xs text-muted-foreground">{t(`voice.analysis.${k}`)}</dt>
                      <dd className="break-words">{String(analysis[k])}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("voice.call.results")} description={t("voice.call.resultsHint")} />
            <CardBody>
              {results.length ? (
                <ul className="grid gap-2 text-sm">
                  {results.map((r) => (
                    <li key={`${r.type}:${r.id}`} className="flex items-start gap-2">
                      <Badge tone="info">{t(`voice.resultTypes.${r.type}`)}</Badge>
                      {r.href ? <Link href={`/${locale}${r.href}`} className="hover:underline">{r.label}</Link> : <span>{r.label}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{call.processedAt ? t("voice.call.noResults") : t("voice.call.notProcessed")}</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>,
  );
}
