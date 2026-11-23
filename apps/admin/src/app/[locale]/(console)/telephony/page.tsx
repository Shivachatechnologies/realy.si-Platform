import Link from "next/link";
import { Bot, Hash, Phone, PhoneCall, PhoneForwarded, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, Facts, FilterBar, NextPage, QuickFilters, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { RecordingAccess } from "@/components/admin/security/actions";
import { SourceNote, money, pct } from "@/components/admin/security/page-kit";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { listVoiceAgents, listVoiceCalls, listVoiceNumbers, telephonyOverview } from "@/server/modules/admin/telephony-admin";
import { requireViewer } from "@/server/session";

const STATUSES = ["live", "AWAITING_APPROVAL", "SCHEDULED", "QUEUED", "ENDED", "FAILED", "BLOCKED", "CANCELLED"] as const;

/** Telephony across tenants: providers, numbers, AI voice agents, call sessions, queues, transfers, costs, webhooks. */
export default async function TelephonyPage({ searchParams }: PageProps<"/[locale]/telephony">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const tab = (["calls", "numbers", "agents"] as const).find((x) => x === sp(q.tab)) ?? "calls";
  const params = { tab: tab === "calls" ? undefined : tab, status: sp(q.status), direction: sp(q.direction), org: sp(q.org), transferred: sp(q.transferred) };
  const r = await guard(
    Promise.all([
      telephonyOverview(viewer.ctx),
      tab === "calls" ? listVoiceCalls(viewer.ctx, { ...params, cursor: sp(q.cursor) }) : null,
      tab === "numbers" ? listVoiceNumbers(viewer.ctx, { cursor: sp(q.cursor), org: params.org }) : null,
      tab === "agents" ? listVoiceAgents(viewer.ctx, { cursor: sp(q.cursor) }) : null,
      canPlatform(viewer.ctx, "platform.security.manage"),
    ]),
    t("errors.forbidden"),
  );
  if (!r.ok) return r.node;
  const [o, calls, numbers, agents, canRecordings] = r.value;
  const base = `/${locale}/telephony`;
  const n = (v: number) => formatNumber(v, locale);
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader icon={<Phone />} title={t("admin.telephony.title")} description={t("admin.telephony.subtitle")} why={t("admin.telephony.why")} meta={<SourceNote source="voice_calls · voice_phone_numbers · voice_agents · cost_ledger_entries" at={new Date()} label={{ source: t("admin.settings.kit.source"), updated: t("admin.settings.kit.updated") }} />} />
      <StatGrid>
        <StatTile icon={<PhoneCall />} label={t("admin.telephony.calls30d")} value={n(o.calls30d.total)} hint={t("admin.telephony.minutes", { count: o.calls30d.minutes })} />
        <StatTile label={t("admin.telephony.failureRate")} value={pct(o.calls30d.failureRate, locale) ?? t("admin.settings.kit.noData")} tone={o.calls30d.failureRate && o.calls30d.failureRate > 0.1 ? "danger" : undefined} href={`${base}?status=FAILED`} />
        <StatTile icon={<Timer />} label={t("admin.telephony.liveQueued")} value={`${o.live} / ${o.queued}`} hint={t("admin.telephony.liveQueuedHint")} href={`${base}?status=live`} live={o.live > 0} />
        <StatTile icon={<PhoneForwarded />} label={t("admin.telephony.transfers")} value={n(o.calls30d.transfers)} href={`${base}?transferred=1`} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={t("admin.telephony.providers")} description={t("admin.telephony.providersHint")} actions={<Link href={`/${locale}/keys`} className="text-xs text-primary hover:underline">{t("admin.email.manageKeys")}</Link>} />
          <Facts
            rows={[
              ...o.providers.platformKeys.map((k): [string, React.ReactNode] => [k.name, <Badge key={k.provider} tone={k.state === "configured" ? "success" : k.state === "partial" ? "warning" : "neutral"}>{t(`admin.integrations.keyStates.${k.state}`)}</Badge>]),
              [t("admin.telephony.twilioConnections"), Object.keys(o.providers.twilioConnections).length ? Object.entries(o.providers.twilioConnections).map(([s, c]) => `${s}: ${c}`).join(" · ") : t("admin.settings.kit.noData")],
              [t("admin.telephony.webhooks"), t("admin.telephony.webhooksNotLogged")],
            ]}
          />
        </Card>
        <Card>
          <CardHeader icon={<Hash />} title={t("admin.telephony.numbersAgents")} />
          <Facts
            rows={[
              ...o.numbers.map((x): [string, React.ReactNode] => [`${t("admin.telephony.numbers")} · ${x.provider} / ${x.source}`, n(x.count)]),
              ...o.agents.map((x): [string, React.ReactNode] => [`${t("admin.telephony.agents")} · ${x.provider} / ${x.syncStatus}`, n(x.count)]),
            ]}
          />
          {!o.numbers.length && !o.agents.length ? <p className="p-4 text-sm text-muted-foreground">{t("admin.settings.kit.noData")}</p> : null}
        </Card>
        <Card>
          <CardHeader title={t("admin.telephony.costs30d")} description={t("admin.telephony.costsHint")} />
          <Facts
            rows={[
              ...o.callCosts.map((c): [string, React.ReactNode] => [t("admin.telephony.callCosts", { currency: c.currency }), `${money(c.providerMinor, c.currency, locale)} + ${money(c.telephonyMinor, c.currency, locale)}`]),
              ...o.ledger.map((l): [string, React.ReactNode] => [`${l.category} · ${l.provider}`, money(Math.round(l.costMicros / 10_000), "USD", locale)]),
            ]}
          />
          {!o.callCosts.length && !o.ledger.length ? <p className="p-4 text-sm text-muted-foreground">{t("admin.settings.kit.noData")}</p> : null}
        </Card>
      </div>
      {o.topOrganizations.length ? (
        <Card>
          <CardHeader title={t("admin.telephony.topOrgs")} />
          <ul className="divide-y text-sm">
            {o.topOrganizations.map((x) => (
              <li key={x.organizationId} className="flex items-center justify-between gap-2 px-4 py-2">
                <Link href={`${base}?org=${x.organizationId}`} className="hover:underline">{x.organizationName}</Link>
                <span className="text-xs text-muted-foreground">{t("admin.telephony.orgUsage", { calls: x.calls, minutes: x.minutes })}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card>
        <QuickFilters base={base} name="tab" value={params.tab} params={{ org: params.org }} label={t("admin.telephony.views")} options={[{ value: "", label: t("admin.telephony.callSessions") }, { value: "numbers", label: t("admin.telephony.numbers") }, { value: "agents", label: t("admin.telephony.agents") }]} />
        {calls ? (
          <>
            <FilterBar
              action={base}
              values={params}
              submitLabel={t("admin.settings.kit.apply")}
              filters={[
                { name: "status", label: t("admin.telephony.status"), options: STATUSES.map((s) => ({ value: s, label: t(`admin.telephony.statuses.${s}`) })) },
                { name: "direction", label: t("admin.telephony.direction"), options: [{ value: "OUTBOUND", label: t("admin.telephony.outbound") }, { value: "INBOUND", label: t("admin.telephony.inbound") }] },
              ]}
              extra={params.org ? <input type="hidden" name="org" value={params.org} /> : undefined}
            />
            {calls.data.length === 0 ? (
              <EmptyState icon={<PhoneCall />} title={t("admin.telephony.noCalls")} body={t("admin.common.tryOtherFilters")} />
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>{t("admin.telephony.call")}</Th>
                    <Th>{t("admin.telephony.status")}</Th>
                    <Th>{t("admin.telephony.duration")}</Th>
                    <Th>{t("admin.telephony.cost")}</Th>
                    <Th>{t("admin.settings.kit.organization")}</Th>
                    <Th>{t("admin.settings.kit.when")}</Th>
                    <Th className="text-end">{t("admin.telephony.recording")}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {calls.data.map((c) => (
                    <Tr key={c.id}>
                      <Td className="text-xs">
                        <span className="font-mono">{c.direction === "OUTBOUND" ? "→" : "←"} {c.toNumber}</span>
                        <div className="text-[11px] text-muted-foreground">{[c.provider, c.telephony, c.transferredTo ? t("admin.telephony.transferredTo", { to: c.transferredTo }) : null].filter(Boolean).join(" · ")}</div>
                      </Td>
                      <Td>
                        <StatusBadge domain="voiceCall" value={c.status}>{t(`admin.telephony.statuses.${c.status}`)}</StatusBadge>
                        {c.error || c.blockedReason ? <div className="max-w-48 truncate text-[11px] text-danger">{c.error ?? c.blockedReason}</div> : null}
                      </Td>
                      <Td className="text-xs tabular-nums">{c.durationSec !== null ? `${Math.floor(c.durationSec / 60)}:${String(c.durationSec % 60).padStart(2, "0")}` : "—"}</Td>
                      <Td className="text-xs">{c.costMinor !== null || c.telephonyCostMinor !== null ? money((c.costMinor ?? 0) + (c.telephonyCostMinor ?? 0), c.costCurrency, locale) : "—"}</Td>
                      <Td className="text-xs"><Link href={`${base}?org=${c.organizationId}`} className="hover:underline">{c.organizationName}</Link></Td>
                      <Td className="text-xs text-muted-foreground"><Timestamp value={c.createdAt} mode="relative" /></Td>
                      <Td className="text-end">{canRecordings && (c.hasRecording || c.status === "ENDED") ? <RecordingAccess callId={c.id} /> : null}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
            <NextPage base={base} params={params} cursor={calls.nextCursor} label={t("common.next")} />
          </>
        ) : null}
        {numbers ? (
          <>
            {numbers.data.length === 0 ? (
              <EmptyState icon={<Hash />} title={t("admin.telephony.noNumbers")} />
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>{t("admin.telephony.number")}</Th>
                    <Th>{t("admin.telephony.provider")}</Th>
                    <Th>{t("admin.telephony.inboundAgent")}</Th>
                    <Th>{t("admin.settings.kit.organization")}</Th>
                    <Th>{t("admin.telephony.state")}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {numbers.data.map((x) => (
                    <Tr key={x.id}>
                      <Td className="font-mono text-xs">{x.number}{x.label ? <span className="ms-1 font-sans text-muted-foreground">{x.label}</span> : null}</Td>
                      <Td className="text-xs">{x.provider} · {x.source}</Td>
                      <Td className="text-xs">{x.inboundAgent?.name ?? "—"}</Td>
                      <Td className="text-xs">{x.organizationName}</Td>
                      <Td>{x.releasedAt ? <Badge tone="neutral">{t("admin.telephony.released")}</Badge> : <Badge tone="success">{t("admin.telephony.activeNumber")}</Badge>}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
            <NextPage base={base} params={params} cursor={numbers.nextCursor} label={t("common.next")} />
          </>
        ) : null}
        {agents ? (
          <>
            {agents.data.length === 0 ? (
              <EmptyState icon={<Bot />} title={t("admin.telephony.noAgents")} />
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>{t("admin.telephony.agent")}</Th>
                    <Th>{t("admin.telephony.provider")}</Th>
                    <Th>{t("admin.telephony.sync")}</Th>
                    <Th>{t("admin.telephony.calls30d")}</Th>
                    <Th>{t("admin.settings.kit.organization")}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {agents.data.map((a) => (
                    <Tr key={a.id}>
                      <Td className="text-xs"><span className="font-medium">{a.name}</span><div className="text-[11px] text-muted-foreground">{a.goal} · {a.language}</div></Td>
                      <Td className="text-xs">{a.provider}</Td>
                      <Td><Badge tone={a.syncStatus === "SYNCED" ? "success" : a.syncStatus === "ERROR" ? "danger" : "neutral"}>{a.syncStatus}</Badge>{a.syncError ? <div className="max-w-48 truncate text-[11px] text-danger">{a.syncError}</div> : null}</Td>
                      <Td className="text-xs tabular-nums">{a.calls30d}</Td>
                      <Td className="text-xs">{a.organizationName}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
            <NextPage base={base} params={params} cursor={agents.nextCursor} label={t("common.next")} />
          </>
        ) : null}
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">{t("admin.telephony.voiceDisableHint")}</p>
      </Card>
    </div>
  );
}
