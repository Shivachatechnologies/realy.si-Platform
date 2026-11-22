import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DisconnectButton, DocsLink, OAuthConnectButton } from "@/components/integrations/setup";
import { formatCostMicros } from "@/components/integrations/usage-format";
import { SyncTable } from "@/components/integrations/sync-table";
import { BankFeedCard, ProviderEventsCard } from "@/components/integrations/provider-panels";
import { listProviderEventsFor } from "@/server/modules/integrations/provider-webhooks";
import { bankFeed } from "@/server/modules/integrations/services/banking";
import { integrationTabLabels, IntegrationsTabs } from "@/components/integrations/tabs";
import { Forbidden, NoCompany, PageFrame } from "@/components/automation/page-frame";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { customerConnectMode, providerInfo } from "@/server/modules/integrations/catalog";
import { getIntegration, usageSummary } from "@/server/modules/integrations/service";
import { providerRateLimit } from "@/server/modules/integrations/client";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata({ params }: PageProps<"/[locale]/integrations/[provider]">): Promise<Metadata> {
  const { provider } = await params;
  return { title: providerInfo(provider)?.name ?? (await getT())("modules.integrations.title") };
}

const windowKey = (ms: number) => (ms <= 1_000 ? "sec1" : ms <= 10_000 ? "sec10" : ms <= 60_000 ? "min1" : ms <= 15 * 60_000 ? "min15" : "hour1");

const TONE = { CONNECTED: "success", ERROR: "danger", DISCONNECTED: "neutral" } as const;
const OAUTH_ERRORS = ["not_configured", "state_mismatch", "provider_error", "access_denied", "forbidden", "invalid_request", "rate_limited"];

export default async function IntegrationPage({ params, searchParams }: PageProps<"/[locale]/integrations/[provider]">) {
  const { provider } = await params;
  const sp = await searchParams;
  const info = providerInfo(provider);
  if (!info) notFound();
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const back = (
    <Link href={`/${locale}/integrations`} className="text-sm text-muted-foreground hover:underline">
      ← {t("integrations.backToMarketplace")}
    </Link>
  );
  const frame = (children: React.ReactNode) => (
    <PageFrame title={info.name} subtitle={t(`integrations.providers.${info.key}.description`)} actions={back}>
      {children}
    </PageFrame>
  );
  if (!company) return frame(<NoCompany message={t("company.empty")} />);
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "integrations.read", chain), can(viewer.ctx, "integrations.manage", chain)]);
  if (!canRead) return frame(<Forbidden message={t("errors.forbidden")} />);
  const data = await getIntegration(viewer.ctx, org.id, company.id, provider);
  const base = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const tz = company.timezone ?? "UTC";
  const conn = data.connection;
  const oauthError = typeof sp.oauthError === "string" && OAUTH_ERRORS.includes(sp.oauthError) ? sp.oauthError : null;
  const isBankFeed = info.key === "plaid" || info.key === "wise";
  const [usage, events, feed] = await Promise.all([
    info.key === "webhook" ? null : usageSummary(viewer.ctx, org.id, company.id, { provider }),
    info.inboundWebhooks && (conn || data.previous) ? listProviderEventsFor(org.id, company.id, provider) : null,
    conn && isBankFeed ? bankFeed(viewer.ctx, org.id, company.id, info.key as "plaid" | "wise", 20) : null,
  ]);
  const rate = providerRateLimit(info.key);
  const tabs = (
    <IntegrationsTabs
      locale={locale}
      active="marketplace"
      labels={integrationTabLabels(t)}
    />
  );

  if (data.platform) {
    // Platform-managed provider (AI, research, creative, voice, video, telephony): runs on the platform's account. No
    // key entry or setup here — customers only see whether it is available; usage counts against their plan.
    const available = data.platform === "available";
    return frame(
      <>
        {tabs}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid content-start gap-4">
            <Card>
              <CardHeader
                title={t("integrations.platform.title")}
                actions={
                  <Badge tone={available ? "success" : "neutral"}>
                    <StatusDot tone={available ? "success" : "neutral"} />
                    {available ? t("integrations.platform.available") : t("integrations.platform.unavailable")}
                  </Badge>
                }
              />
              <CardBody className="grid gap-3 text-sm">
                <p>{available ? t("integrations.platform.availableBody", { name: info.name }) : data.platform === "disabled" ? t("integrations.platform.disabledBody", { name: info.name }) : t("integrations.platform.unavailableBody", { name: info.name })}</p>
                <p className="text-muted-foreground">{t("integrations.platform.usageBody")}</p>
                {data.plan.locked ? <Notice tone="warning">{t("integrations.marketplace.planLockedNotice", { plan: t(`integrations.marketplace.plans.${data.plan.minPlan}`) })}</Notice> : null}
              </CardBody>
            </Card>
            {usage && usage.totals.calls > 0 ? (
              <Card>
                <CardHeader
                  title={t("integrations.usage.title")}
                  description={t("integrations.usage.cardSummary", { calls: usage.totals.calls, failed: usage.totals.failed, cost: formatCostMicros(usage.totals.costMicros, locale) })}
                  actions={
                    <Link href={`/${locale}/integrations/${info.key}/usage`} className="text-sm text-primary hover:underline">
                      {t("integrations.usage.open")}
                    </Link>
                  }
                />
              </Card>
            ) : null}
          </div>
          <div className="grid content-start gap-4">
            <Card>
              <CardHeader title={t("integrations.about")} />
              <CardBody className="grid gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">{t("integrations.category")}</p>
                  <p>{t(`integrations.categories.${info.category}`)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("integrations.authType")}</p>
                  <p>{t("integrations.platform.managedBy")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("integrations.powers")}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {info.capabilities.map((c) => (
                      <Badge key={c}>{t(`integrations.capabilities.${c}`)}</Badge>
                    ))}
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </>,
    );
  }

  // Customer-connected providers: an OAuth login to the customer's OWN account is the only thing they can do here.
  // Everything else (API keys, credentials, settings, webhooks) is managed by Realy in the Control Center.
  const mode = customerConnectMode(info);
  const oauth = mode === "oauth";
  const canConnect = oauth && canManage && !data.disabled && data.oauthAvailable && !data.plan.locked;

  return frame(
    <>
      {tabs}
      {sp.connected === "1" ? <Notice tone="success">{t("integrations.connectedNotice")}</Notice> : null}
      {oauthError ? <Notice tone="danger">{t(`integrations.oauthErrors.${oauthError}`)}</Notice> : null}
      {data.disabled ? <Notice tone="warning">{t("integrations.platform.providerDisabled", { name: info.name })}</Notice> : null}
      {!data.disabled && oauth && !data.oauthAvailable ? <Notice tone="info">{t("integrations.platform.oauthNotReady", { name: info.name })}</Notice> : null}
      {!oauth ? <Notice tone="info">{conn ? t("integrations.platform.legacyConnection", { name: info.name }) : t("integrations.platform.notConnectable", { name: info.name })}</Notice> : null}
      {data.plan.locked && !conn ? <Notice tone="warning">{t("integrations.marketplace.planLockedNotice", { plan: t(`integrations.marketplace.plans.${data.plan.minPlan}`) })}</Notice> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader
              title={t("integrations.connection")}
              actions={
                conn ? (
                  <Badge tone={TONE[conn.status]}>
                    <StatusDot tone={TONE[conn.status]} />
                    {t(`integrations.status.${conn.status}`)}
                  </Badge>
                ) : (
                  <Badge>{t("integrations.status.NOT_CONNECTED")}</Badge>
                )
              }
            />
            <CardBody className="grid gap-4">
              {conn ? (
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("integrations.account")}</dt>
                    <dd>{conn.externalAccount ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("integrations.connectedAt")}</dt>
                    <dd>{formatDateTime(conn.connectedAt, locale, tz)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("integrations.lastSync")}</dt>
                    <dd>{conn.lastSyncAt ? formatDateTime(conn.lastSyncAt, locale, tz) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("integrations.health.lastSuccess")}</dt>
                    <dd>{conn.lastSuccessAt ? formatDateTime(conn.lastSuccessAt, locale, tz) : "—"}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">{oauth ? t("integrations.platform.oauthHelp", { name: info.name }) : t("integrations.notConnectedHelp")}</p>
              )}
              {conn?.status === "ERROR" ? <Notice tone="danger">{oauth ? t("integrations.platform.reconnectHint", { name: info.name }) : t("integrations.platform.failingHint")}</Notice> : null}
              {canConnect ? (
                <div className="flex flex-wrap items-center gap-3">
                  <OAuthConnectButton provider={info.key} name={info.name} orgId={org.id} companyId={company.id} locale={locale} reconnect={!!conn} />
                  <p className="text-xs text-muted-foreground">{t("integrations.oauthHelp")}</p>
                </div>
              ) : null}
              {conn && oauth && canManage ? <DisconnectButton base={base} provider={info.key} /> : null}
              {!canManage ? <p className="text-xs text-muted-foreground">{t("integrations.manageHint")}</p> : null}
            </CardBody>
          </Card>

          {feed && isBankFeed ? <BankFeedCard t={t} provider={info.key as "plaid" | "wise"} feed={feed} base={base} locale={locale} tz={tz} canManage={canManage} returned={sp.plaid === "return"} /> : null}
          {events ? <ProviderEventsCard t={t} rows={events.data.slice(0, 15)} locale={locale} tz={tz} /> : null}

          {usage && (conn || usage.totals.calls > 0) ? (
            <Card>
              <CardHeader
                title={t("integrations.usage.title")}
                description={t("integrations.usage.cardSummary", { calls: usage.totals.calls, failed: usage.totals.failed, cost: formatCostMicros(usage.totals.costMicros, locale) })}
                actions={
                  <Link href={`/${locale}/integrations/${info.key}/usage`} className="text-sm text-primary hover:underline">
                    {t("integrations.usage.open")}
                  </Link>
                }
              />
            </Card>
          ) : null}

          {conn || data.previous ? (
            <Card>
              <CardHeader
                title={t("integrations.logs.title")}
                description={t("integrations.logs.cardHelp")}
                actions={
                  <Link href={`/${locale}/integrations/${info.key}/logs`} className="text-sm text-primary hover:underline">
                    {t("integrations.logs.open")}
                  </Link>
                }
              />
            </Card>
          ) : null}

          {info.syncKinds?.length && conn ? (
            <Card>
              <CardHeader title={t("integrations.syncHistory")} description={t(`integrations.providers.${info.key}.sync`)} />
              {data.syncs.length ? <SyncTable rows={data.syncs} t={t} locale={locale} tz={tz} /> : <p className="p-4 text-muted-foreground">{t("integrations.syncs.empty")}</p>}
            </Card>
          ) : null}
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("integrations.about")} />
            <CardBody className="grid gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">{t("integrations.category")}</p>
                <p>{t(`integrations.categories.${info.category}`)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("integrations.authType")}</p>
                <p>{oauth ? t("integrations.platform.oauthLogin") : t("integrations.platform.managedBy")}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("integrations.powers")}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {info.capabilities.map((c) => (
                    <Badge key={c}>{t(`integrations.capabilities.${c}`)}</Badge>
                  ))}
                </div>
              </div>
              {info.key !== "webhook" && info.authType !== "none" ? (
                <div>
                  <p className="text-xs text-muted-foreground">{t("integrations.marketplace.rateLimit")}</p>
                  <p>{t("integrations.marketplace.rateLimitValue", { limit: rate.limit, window: t(`integrations.marketplace.windows.${windowKey(rate.windowMs)}`) })}</p>
                </div>
              ) : null}
              <DocsLink href={info.docsUrl} label={t("integrations.docs")} />
            </CardBody>
          </Card>
          {info.scopes.length ? (
            <Card>
              <CardHeader title={t("integrations.permissions")} description={t("integrations.permissionsHelp")} />
              <ul className="grid gap-1 p-4">
                {(conn?.scopes.length ? conn.scopes : info.scopes).map((s) => (
                  <li key={s}>
                    <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{s}</code>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card>
            <CardHeader title={t("integrations.security")} />
            <p className="p-4 text-sm text-muted-foreground">{t("integrations.securityBody")}</p>
          </Card>
        </div>
      </div>
    </>,
  );
}
