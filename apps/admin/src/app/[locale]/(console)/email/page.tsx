import Link from "next/link";
import { Ban, Inbox, Mail, MailCheck, MailWarning, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, Facts, FilterBar, NextPage, QuickFilters, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { ActionButton } from "@/components/admin/action-dialog";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { AddSuppression, ProbeButton, TestSendEmail } from "@/components/admin/security/actions";
import { SourceNote, pct } from "@/components/admin/security/page-kit";
import { getLocale, getT } from "@/i18n/server";
import { capabilitiesFor } from "@/server/modules/admin/access";
import { emailOverview, listEmailMessages, listSuppressions } from "@/server/modules/admin/email-admin";
import { requireViewer } from "@/server/session";

/** Email & communication: provider status, delivery log with provider events, rates, suppression list, tests. */
export default async function EmailPage({ searchParams }: PageProps<"/[locale]/email">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const tab = sp(q.tab) === "suppressions" ? "suppressions" : "messages";
  const params = { tab: tab === "suppressions" ? "suppressions" : undefined, status: sp(q.status), template: sp(q.template), q: sp(q.q), outcome: sp(q.outcome), org: sp(q.org), reason: sp(q.reason) };
  const r = await guard(
    Promise.all([
      emailOverview(viewer.ctx),
      tab === "messages" ? listEmailMessages(viewer.ctx, { ...params, cursor: sp(q.cursor) }) : null,
      tab === "suppressions" ? listSuppressions(viewer.ctx, { q: params.q, reason: params.reason, cursor: sp(q.cursor) }) : null,
      capabilitiesFor(viewer.ctx, ["platform.controls.manage", "platform.security.manage"]),
    ]),
    t("errors.forbidden"),
  );
  if (!r.ok) return r.node;
  const [o, messages, suppressions, caps] = r.value;
  const canManage = caps["platform.controls.manage"] || caps["platform.security.manage"];
  const base = `/${locale}/email`;
  const s = o.status;
  const rate = (v: number | null) => (o.eventsTracked ? (pct(v, locale) ?? t("admin.settings.kit.noData")) : t("admin.settings.kit.notTracked"));
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader
        icon={<Mail />}
        title={t("admin.email.title")}
        description={t("admin.email.subtitle")}
        why={t("admin.email.why")}
        actions={
          canManage && s.configured ? (
            <TestSendEmail defaultTo={viewer.user.email} />
          ) : null
        }
        meta={<SourceNote source="email_messages · email_events · email_suppressions" at={o.lastEventAt} label={{ source: t("admin.settings.kit.source"), updated: t("admin.email.lastEvent") }} />}
      />
      {!o.eventsTracked ? <Notice tone="info">{t("admin.email.eventsNotTracked")}</Notice> : null}
      <StatGrid>
        <StatTile icon={<Inbox />} label={t("admin.email.accepted7d")} value={o.messages.sent} hint={t("admin.email.acceptedHint")} href={`${base}?status=SENT`} />
        <StatTile icon={<MailCheck />} label={t("admin.email.deliveredRate")} value={rate(o.rates.delivered)} hint={o.eventsTracked ? t("admin.email.deliveredCount", { count: o.events.delivered }) : t("admin.email.needsWebhook")} />
        <StatTile icon={<MailWarning />} label={t("admin.email.bounceRate")} value={rate(o.rates.bounce)} hint={t("admin.email.complaintRate", { rate: rate(o.rates.complaint) })} tone={o.events.bounced ? "warning" : undefined} href={`${base}?outcome=bounced`} />
        <StatTile icon={<ShieldAlert />} label={t("admin.email.failed7d")} value={o.messages.failed} hint={t("admin.email.notConfigured", { count: o.messages.notConfigured })} tone={o.messages.failed ? "danger" : undefined} href={`${base}?status=FAILED`} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.email.provider")} description={t("admin.email.providerHint")} actions={<Link href={`/${locale}/keys`} className="text-xs text-primary hover:underline">{t("admin.email.manageKeys")}</Link>} />
          <Facts
            rows={[
              [t("admin.email.provider"), s.provider ? <Badge key="p" tone={s.configured ? "success" : "warning"}>{s.provider}</Badge> : <Badge key="p" tone="warning">{t("admin.settings.kit.notConfigured")}</Badge>],
              [t("admin.email.from"), s.from ?? t("admin.settings.kit.notConfigured")],
              [t("admin.email.senderDomain"), s.senderDomain ?? "—"],
              [t("admin.email.credentials"), s.provider === "smtp" ? (s.smtp ? `${s.smtp.host}:${s.smtp.port} · ${s.smtp.secure ? "TLS" : "STARTTLS"} · ${s.smtp.authenticated ? t("admin.email.smtpAuth") : t("admin.email.smtpRelay")}` : t("admin.settings.kit.notConfigured")) : s.apiKeySet ? t("admin.email.keySet") : t("admin.settings.kit.notConfigured")],
              ...s.webhooks.map((w): [string, React.ReactNode] => [t("admin.email.webhook", { provider: w.provider }), <span key={w.provider} className="inline-flex items-center gap-1 text-xs"><Badge tone={w.configured ? "success" : "neutral"}>{w.configured ? t("admin.email.signed") : t("admin.settings.kit.notConfigured")}</Badge><span className="font-mono text-[11px] text-muted-foreground">{w.path}</span></span>]),
            ]}
          />
          {canManage && s.provider ? (
            <div className="flex flex-wrap gap-4 border-t p-4">
              <ProbeButton path="/api/v1/admin/email/test-connection" label={t("admin.email.testConnection")} />
              <ProbeButton path="/api/v1/admin/email/sender" label={t("admin.email.checkSender")} />
            </div>
          ) : null}
        </Card>
        <Card>
          <CardHeader title={t("admin.email.events7d")} description={t("admin.email.events7dHint")} />
          <Facts
            rows={(["delivered", "bounced", "complained", "deferred", "opened", "clicked"] as const).map((k): [string, React.ReactNode] => [t(`admin.email.eventTypes.${k}`), o.eventsTracked ? String(o.events[k]) : t("admin.settings.kit.notTracked")])}
          />
          <div className="border-t px-4 py-2 text-xs text-muted-foreground">
            {t("admin.email.suppressedTotal", { count: o.suppressions.total })} {o.suppressions.byReason.map((b) => `${t(`admin.email.reasons.${b.reason}`)}: ${b.count}`).join(" · ")}
          </div>
        </Card>
      </div>
      <Card>
        <QuickFilters base={base} name="tab" value={params.tab} params={{}} label={t("admin.email.views")} options={[{ value: "", label: t("admin.email.deliveryLog") }, { value: "suppressions", label: t("admin.email.suppressions") }]} />
        {tab === "messages" && messages ? (
          <>
            <FilterBar
              action={base}
              q={params.q}
              qLabel={t("admin.email.searchRecipient")}
              values={params}
              submitLabel={t("admin.settings.kit.apply")}
              filters={[
                { name: "status", label: t("admin.email.status"), options: (["SENT", "FAILED", "NOT_CONFIGURED"] as const).map((v) => ({ value: v, label: t(`admin.email.statuses.${v}`) })) },
                { name: "outcome", label: t("admin.email.outcome"), options: (["delivered", "bounced", "complained", "deferred", "none"] as const).map((v) => ({ value: v, label: v === "none" ? t("admin.email.noEvent") : t(`admin.email.eventTypes.${v}`) })) },
                { name: "template", label: t("admin.email.template"), options: messages.templates.map((x) => ({ value: x.template, label: `${x.template} (${x.count})` })) },
              ]}
            />
            {messages.data.length === 0 ? (
              <EmptyState icon={<Mail />} title={t("admin.email.empty")} body={t("admin.common.tryOtherFilters")} />
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>{t("admin.email.recipient")}</Th>
                    <Th>{t("admin.email.template")}</Th>
                    <Th>{t("admin.email.status")}</Th>
                    <Th>{t("admin.email.outcome")}</Th>
                    <Th>{t("admin.settings.kit.when")}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {messages.data.map((m) => (
                    <Tr key={m.id}>
                      <Td className="text-xs">
                        <Link href={`${base}/messages/${m.id}`} className="text-primary hover:underline">{m.toEmail}</Link>
                      </Td>
                      <Td className="font-mono text-[11px]">{m.template}</Td>
                      <Td>
                        <StatusBadge domain="emailStatus" value={m.status}>{t(`admin.email.statuses.${m.status}`)}</StatusBadge>
                        {m.error ? <div className="max-w-xs truncate text-[11px] text-danger">{m.error}</div> : null}
                      </Td>
                      <Td>{m.outcome ? <StatusBadge domain="emailEvent" value={m.outcome}>{t(`admin.email.eventTypes.${m.outcome}`)}</StatusBadge> : <span className="text-[11px] text-muted-foreground">{m.status === "SENT" ? t("admin.email.acceptedOnly") : "—"}</span>}</Td>
                      <Td className="text-xs text-muted-foreground"><Timestamp value={m.createdAt} mode="relative" /></Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
            <NextPage base={base} params={params} cursor={messages.nextCursor} label={t("common.next")} />
          </>
        ) : null}
        {tab === "suppressions" && suppressions ? (
          <>
            <FilterBar
              action={base}
              q={params.q}
              qLabel={t("admin.email.searchRecipient")}
              values={params}
              submitLabel={t("admin.settings.kit.apply")}
              filters={[{ name: "reason", label: t("admin.email.reason"), options: (["hard_bounce", "complaint", "manual"] as const).map((v) => ({ value: v, label: t(`admin.email.reasons.${v}`) })) }]}
              extra={
                <>
                  <input type="hidden" name="tab" value="suppressions" />
                  {canManage ? <AddSuppression /> : null}
                </>
              }
            />
            {suppressions.data.length === 0 ? (
              <EmptyState icon={<Ban />} title={t("admin.email.noSuppressions")} body={t("admin.email.noSuppressionsHint")} />
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>{t("admin.email.address")}</Th>
                    <Th>{t("admin.email.reason")}</Th>
                    <Th>{t("admin.email.sourceCol")}</Th>
                    <Th>{t("admin.settings.kit.when")}</Th>
                    <Th className="text-end">{t("admin.common.actions")}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {suppressions.data.map((x) => (
                    <Tr key={x.email}>
                      <Td className="font-mono text-xs">{x.email}</Td>
                      <Td><Badge tone={x.reason === "manual" ? "neutral" : "danger"}>{t(`admin.email.reasons.${x.reason}`)}</Badge>{x.note ? <div className="text-[11px] text-muted-foreground">{x.note}</div> : null}</Td>
                      <Td className="font-mono text-[11px] text-muted-foreground">{x.source ?? "—"}</Td>
                      <Td className="text-xs text-muted-foreground"><Timestamp value={x.createdAt} mode="relative" /></Td>
                      <Td className="text-end">{canManage ? <ActionButton label={t("admin.email.unsuppress")} title={t("admin.email.unsuppressTitle", { email: x.email })} description={t("admin.email.unsuppressHint")} path={`/api/v1/admin/email/suppressions/${encodeURIComponent(x.email)}`} method="DELETE" variant="ghost" /> : null}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
            <NextPage base={base} params={{ tab: "suppressions", q: params.q, reason: params.reason }} cursor={suppressions.nextCursor} label={t("common.next")} />
          </>
        ) : null}
      </Card>
    </div>
  );
}
