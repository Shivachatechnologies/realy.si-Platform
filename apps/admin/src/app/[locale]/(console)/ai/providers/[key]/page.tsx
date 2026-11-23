import Link from "next/link";
import { notFound } from "next/navigation";
import { KeyRound, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, Facts, SectionLink, StatGrid, StatTile, guard, usd } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { ProviderToggle } from "@/components/admin/ai-models-editor";
import { ResetBreakersButton } from "@/components/admin/ai/ai-actions";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { capabilitiesFor } from "@/server/modules/admin/access";
import { aiProviderDetail } from "@/server/modules/admin/ai-requests";
import { requireViewer } from "@/server/session";

/** One AI provider: health from the request log, breakers, models with pricing and state, fallback priority, usage, errors. */
export default async function AdminAiProviderPage({ params }: PageProps<"/[locale]/ai/providers/[key]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { key } = await params;
  const r = await guard(
    aiProviderDetail(viewer.ctx, key).catch((e) => {
      if (isAppError(e) && e.code === "not_found") notFound();
      throw e;
    }),
    t("errors.forbidden"),
  );
  if (!r.ok) return r.node;
  const p = r.value;
  const caps = await capabilitiesFor(viewer.ctx, ["platform.ai.manage", "platform.security.manage"]);
  const n = (v: number) => formatNumber(v, locale);
  const pct = (v: number | null | undefined) => (v == null ? t("admin.aiRequests.noData") : `${(v * 100).toFixed(1)}%`);
  const ms = (v: number | null | undefined) => (v == null ? t("admin.aiRequests.noData") : `${n(v)} ms`);
  const base = `/${locale}/ai`;
  const h = p.health.h24;
  const fallbackRate = h && h.total - h.blocked > 0 ? h.fallbacks / (h.total - h.blocked) : null;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: t("admin.aiRequests.providers"), href: `${base}/models` }, { label: p.label }]} />
      <AdminHeader
        icon={<Server />}
        title={p.label}
        description={t("admin.aiRequests.providerSubtitle")}
        eyebrow={<span className="font-mono">{p.key}</span>}
        actions={
          <>
            {caps["platform.ai.manage"] ? <ResetBreakersButton provider={p.key} label={p.label} /> : null}
            <ProviderToggle provider={p.key} label={p.label} enabled={p.enabled} canManage={caps["platform.ai.manage"]} />
          </>
        }
      />
      {!p.configured ? (
        <Notice tone="warning" title={t("admin.aiModels.notConfigured")} action={<SectionLink href={`/${locale}/keys`}>{t("admin.aiRequests.openKeys")}</SectionLink>}>
          {t("admin.aiRequests.keyMissing", { env: p.envKey })}
        </Notice>
      ) : null}
      <StatGrid>
        <StatTile label={t("admin.aiRequests.requests24h")} value={h ? n(h.total) : "0"} href={`${base}/requests?provider=${p.key}`} />
        <StatTile label={t("admin.aiRequests.errorRate")} value={pct(h?.errorRate)} tone={h?.errorRate && h.errorRate > 0.05 ? "danger" : undefined} href={`${base}/requests?provider=${p.key}&status=ERROR`} />
        <StatTile label={t("admin.aiRequests.latency")} value={ms(h?.p50)} hint={t("admin.aiRequests.p95", { value: ms(h?.p95) })} />
        <StatTile label={t("admin.aiRequests.fallbackRate")} value={pct(fallbackRate)} hint={t("admin.aiRequests.breakersOpen", { count: p.breakers.filter((b) => b.open).length })} tone={p.breakers.some((b) => b.open) ? "warning" : undefined} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<KeyRound />} title={t("admin.aiRequests.configuration")} />
          <Facts
            rows={[
              [t("admin.aiModels.credentials"), p.configured ? <Badge key="c" tone="success">{t("admin.aiModels.configured")}</Badge> : <Badge key="c" tone="danger">{t("admin.aiModels.notConfigured")}</Badge>],
              [t("admin.aiRequests.platformKey"), <Link key="k" className="font-mono hover:underline" href={`/${locale}/keys`}>{p.envKey}</Link>],
              [t("admin.aiModels.enabled"), p.enabled ? t("admin.aiModels.enabled") : t("admin.aiModels.disabled")],
              [t("admin.aiRequests.priority"), t("admin.aiRequests.priorityValue", { n: p.priority })],
              [t("admin.aiRequests.builtInFallback"), <span key="f" className="font-mono text-xs">{`${p.builtInFallback.simple} · ${p.builtInFallback.standard} · ${p.builtInFallback.complex}`}</span>],
              [t("admin.aiModels.fallbackChain"), p.adminFallbackChain.length ? <span key="ch" className="font-mono text-xs">{p.adminFallbackChain.map((c) => c.model).join(" → ")}</span> : t("admin.aiModels.noFallback")],
              [t("admin.aiRequests.limits"), t("admin.aiRequests.limitsNotTracked")],
              [t("admin.aiRequests.usage30d"), `${usd(p.usage30d.costMicros, locale)} · ${t("admin.aiRequests.calls", { count: p.usage30d.calls })}`],
            ]}
          />
        </Card>
        <Card>
          <CardHeader title={t("admin.aiModels.health")} description={t("admin.aiModels.healthHint")} />
          {p.breakers.length === 0 ? (
            <EmptyState title={t("admin.aiModels.noBreakers")} />
          ) : (
            <Table>
              <TBody>
                {p.breakers.map((b) => (
                  <Tr key={b.key}>
                    <Td className="font-mono text-xs">{b.model}</Td>
                    <Td>{b.open ? <Badge tone="danger">{t("admin.aiModels.breakerOpen")}</Badge> : <Badge tone="warning">{t("admin.aiModels.breakerDegraded")}</Badge>}</Td>
                    <Td className="text-xs">{t("admin.aiModels.breakerFailures", { count: b.failures })}</Td>
                    <Td className="text-xs">{b.openedAt ? <Timestamp value={b.openedAt} mode="relative" /> : "—"}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader title={t("admin.aiModels.models")} description={t("admin.aiRequests.modelsHint")} />
        <Table>
          <THead>
            <Tr>
              <Th>{t("admin.aiModels.model")}</Th>
              <Th>{t("admin.aiModels.price")}</Th>
              <Th>{t("admin.aiRequests.requests7d")}</Th>
              <Th>{t("admin.aiRequests.errorRate")}</Th>
              <Th>{t("admin.aiRequests.p95Short")}</Th>
              <Th>{t("admin.aiRequests.usage30d")}</Th>
              <Th>{t("admin.users.columns.status")}</Th>
            </Tr>
          </THead>
          <TBody>
            {p.models.map((m) => (
              <Tr key={m.id}>
                <Td className="font-mono text-xs">
                  <Link className="hover:underline" href={`${base}/requests?model=${encodeURIComponent(m.id)}&window=7d`}>
                    {m.id}
                  </Link>
                </Td>
                <Td className="text-xs tabular-nums">
                  ${m.price.input} / ${m.price.output}
                  <span className="text-muted-foreground"> · {m.price.source === "admin" ? t("admin.aiRequests.priceAdmin") : t("admin.aiRequests.priceList")}</span>
                </Td>
                <Td className="tabular-nums text-xs">{m.stats7d ? n(m.stats7d.total) : "—"}</Td>
                <Td className="tabular-nums text-xs">{m.stats7d ? pct(m.stats7d.errorRate) : "—"}</Td>
                <Td className="tabular-nums text-xs">{m.stats7d ? ms(m.stats7d.p95) : "—"}</Td>
                <Td className="tabular-nums text-xs">{m.ledger30d ? `${usd(m.ledger30d.costMicros, locale)} · ${n(m.ledger30d.calls)}` : "—"}</Td>
                <Td>
                  {m.breakerOpen ? <Badge tone="danger">{t("admin.aiModels.breakerOpen")}</Badge> : m.allowed ? <Badge tone="success">{t("admin.aiModels.enabled")}</Badge> : <Badge tone="warning">{t("admin.aiModels.disabled")}</Badge>}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">{t("admin.aiRequests.priceUnit")}</p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.aiRequests.errorsByCode")} description={t("admin.aiRequests.last7d")} />
          <CardBody>
            {p.errors7d.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("admin.aiRequests.noErrors")}</p>
            ) : (
              <ul className="grid gap-1 text-xs">
                {p.errors7d.map((e) => (
                  <li key={e.key} className="flex justify-between gap-2">
                    <Link className="font-mono hover:underline" href={`${base}/requests?provider=${p.key}&window=7d`}>
                      {e.key}
                    </Link>
                    <span className="tabular-nums">{n(e.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("admin.aiRequests.recentErrors")} description={t("admin.aiRequests.last7d")} />
          {p.recentErrors.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">{t("admin.aiRequests.noErrors")}</p>
          ) : (
            <Table>
              <TBody>
                {p.recentErrors.map((e) => (
                  <Tr key={e.id}>
                    <Td className="text-xs">
                      <Link className="hover:underline" href={`${base}/requests?id=${e.id}&window=7d`}>
                        <Timestamp value={e.createdAt} mode="relative" />
                      </Link>
                    </Td>
                    <Td className="font-mono text-[11px]">{e.servedModel ?? e.requestedModel}</Td>
                    <Td>
                      <StatusBadge domain="aiRequest" value={e.status}>{t(`admin.aiRequests.status.${e.status}`)}</StatusBadge>
                    </Td>
                    <Td className="font-mono text-[11px] text-danger">{e.errorCode ?? "—"}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
