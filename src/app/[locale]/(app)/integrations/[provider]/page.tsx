import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountPicker, ApiKeyForm, ConnectionActions, ConnectionSettingsForm, DocsLink, OAuthConnectButton } from "@/components/integrations/setup";
import { formatCostMicros } from "@/components/integrations/usage-format";
import { CopyText, HookRowActions, NewHookForm } from "@/components/integrations/webhook-managers";
import { SyncTable } from "@/components/integrations/sync-table";
import { integrationTabLabels, IntegrationsTabs } from "@/components/integrations/tabs";
import { Forbidden, NoCompany, PageFrame } from "@/components/automation/page-frame";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { providerInfo, type ConnectionAccount } from "@/server/modules/integrations/catalog";
import { getIntegration, storedSecretNames, usageSummary } from "@/server/modules/integrations/service";
import { listHooks } from "@/server/modules/integrations/webhooks";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata({ params }: PageProps<"/[locale]/integrations/[provider]">): Promise<Metadata> {
  const { provider } = await params;
  return { title: providerInfo(provider)?.name ?? (await getT())("modules.integrations.title") };
}

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
  const hooks = info.key === "webhook" ? await listHooks(viewer.ctx, org.id, company.id) : [];
  const [usage, secretNames] = await Promise.all([
    info.key === "webhook" ? null : usageSummary(viewer.ctx, org.id, company.id, { provider }),
    conn && info.configFields?.length && canManage ? storedSecretNames(org.id, company.id, provider) : Promise.resolve([] as string[]),
  ]);
  const cfg = (conn?.config && typeof conn.config === "object" && !Array.isArray(conn.config) ? conn.config : {}) as Record<string, unknown>;
  const accounts = Array.isArray(cfg.accounts) ? (cfg.accounts as ConnectionAccount[]) : [];
  const activeAccountId = typeof cfg.activeAccountId === "string" ? cfg.activeAccountId : (accounts[0]?.id ?? null);
  const setupSteps = t(`integrations.providers.${info.key}.setup`).split("\n").filter(Boolean);
  const usesOAuth = info.authType === "oauth2" || !!info.oauthAlternative;
  const tabs = (
    <IntegrationsTabs
      locale={locale}
      active="marketplace"
      labels={integrationTabLabels(t)}
    />
  );

  if (info.key === "webhook") {
    return frame(
      <>
        {tabs}
        <Card>
          <CardHeader title={t("integrations.webhooks.incoming")} description={t("integrations.webhooks.incomingHelp")} actions={<Link className="text-sm text-primary hover:underline" href={`/${locale}/integrations/webhooks`}>{t("integrations.webhooks.manageAll")}</Link>} />
          {canManage ? <NewHookForm base={base} /> : null}
          {hooks.length === 0 ? (
            <p className="border-t p-4 text-muted-foreground">{t("integrations.webhooks.noHooks")}</p>
          ) : (
            <ul className="divide-y border-t">
              {hooks.map((h) => (
                <li key={h.id} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="grid min-w-0 gap-1">
                    <Link href={`/${locale}/integrations/webhooks/hooks/${h.id}`} className="font-medium hover:underline">
                      {h.name}
                    </Link>
                    <CopyText value={h.url} label={t("integrations.webhooks.copy")} />
                    <p className="text-xs text-muted-foreground">
                      {t(`integrations.webhooks.verification${h.verification}`)} · {h.active ? t("common.enabled") : t("common.disabled")} · {t("integrations.webhooks.deliveryCount", { count: h._count.deliveries })}
                    </p>
                  </div>
                  {canManage ? <HookRowActions base={base} hookId={h.id} active={h.active} /> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </>,
    );
  }

  return frame(
    <>
      {tabs}
      {sp.connected === "1" ? <Notice tone="success">{t("integrations.connectedNotice")}</Notice> : null}
      {oauthError ? <Notice tone="danger">{t(`integrations.oauthErrors.${oauthError}`)}</Notice> : null}
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
                    <dt className="text-xs text-muted-foreground">{t("integrations.lastTested")}</dt>
                    <dd>{conn.lastTestedAt ? formatDateTime(conn.lastTestedAt, locale, tz) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("integrations.lastSync")}</dt>
                    <dd>{conn.lastSyncAt ? formatDateTime(conn.lastSyncAt, locale, tz) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("integrations.health.lastSuccess")}</dt>
                    <dd>{conn.lastSuccessAt ? formatDateTime(conn.lastSuccessAt, locale, tz) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("integrations.health.lastFailure")}</dt>
                    <dd>
                      {conn.lastFailureAt ? formatDateTime(conn.lastFailureAt, locale, tz) : "—"}
                      {conn.errorStreak > 0 ? <span className="ms-2 text-xs text-danger">{t("integrations.health.streak", { count: conn.errorStreak })}</span> : null}
                    </dd>
                  </div>
                  {conn.tokenExpiresAt ? (
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("integrations.tokenExpires")}</dt>
                      <dd>{formatDateTime(conn.tokenExpiresAt, locale, tz)}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">{t("integrations.notConnectedHelp")}</p>
              )}
              {conn?.lastError ? <Notice tone="danger">{conn.lastError}</Notice> : null}

              {info.oauthAlternative && !data.oauthAvailable ? null : usesOAuth ? (
                data.missingEnv.length && !data.oauthAvailable ? (
                  <Notice tone="warning">
                    <p className="font-medium">{t("integrations.notConfiguredTitle")}</p>
                    <p className="mt-1">{t("integrations.notConfiguredBody")}</p>
                    <ul className="mt-2 grid gap-1">
                      {data.missingEnv.map((v) => (
                        <li key={v}>
                          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{v}</code>
                        </li>
                      ))}
                    </ul>
                    {data.redirectUri ? (
                      <p className="mt-2 text-xs">
                        {t("integrations.redirectUri")}: <code className="break-all font-mono">{data.redirectUri}</code>
                      </p>
                    ) : null}
                  </Notice>
                ) : canManage ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <OAuthConnectButton provider={info.key} name={info.name} orgId={org.id} companyId={company.id} locale={locale} reconnect={!!conn} />
                    <p className="text-xs text-muted-foreground">{t("integrations.oauthHelp")}</p>
                  </div>
                ) : null
              ) : null}

              {info.oauthAlternative && data.oauthAvailable && canManage ? <p className="text-xs text-muted-foreground">{t("integrations.orApiKey")}</p> : null}
              {info.authType === "api_key" && canManage ? (
                <div className="grid gap-2">
                  <h3 className="text-sm font-medium">{conn ? t("integrations.replaceCredentials") : t("integrations.enterCredentials")}</h3>
                  <ApiKeyForm base={base} provider={info.key} fields={info.fields ?? []} connected={!!conn} />
                </div>
              ) : null}

              {conn && canManage ? <ConnectionActions base={base} provider={info.key} canSync={!!info.syncKinds?.length} syncEnabled={conn.syncEnabled} syncIntervalMinutes={conn.syncIntervalMinutes} /> : null}
              {!canManage ? <p className="text-xs text-muted-foreground">{t("integrations.manageHint")}</p> : null}
            </CardBody>
          </Card>

          {!conn ? (
            <Card>
              <CardHeader title={t("integrations.setup.title")} description={t("integrations.setup.help")} />
              <ol className="grid list-decimal gap-2 p-4 ps-8 text-sm">
                {setupSteps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
                {info.authType === "oauth2" ? (
                  <>
                    <li>{t("integrations.setup.oauthEnv", { vars: info.envVars.join(", ") })}</li>
                    {data.redirectUri ? (
                      <li>
                        {t("integrations.setup.oauthRedirect")} <code className="break-all font-mono text-xs" dir="ltr">{data.redirectUri}</code>
                      </li>
                    ) : null}
                    <li>{t("integrations.setup.oauthConnect", { name: info.name })}</li>
                  </>
                ) : info.authType === "api_key" ? (
                  <li>{t("integrations.setup.apiKeyPaste", { fields: (info.fields ?? []).filter((f) => f.required).map((f) => t(`integrations.fields.${f.labelKey ?? f.key}`)).join(", ") })}</li>
                ) : null}
              </ol>
            </Card>
          ) : null}

          {conn && info.multiAccount ? (
            <Card>
              <CardHeader title={t("integrations.accounts.title")} description={t("integrations.accounts.help")} />
              <div className="p-4">{accounts.length ? <AccountPicker base={base} provider={info.key} accounts={accounts} activeId={activeAccountId} canManage={canManage} /> : <p className="text-sm text-muted-foreground">{t("integrations.accounts.empty")}</p>}</div>
            </Card>
          ) : null}

          {conn && info.configFields?.length && canManage ? (
            <Card>
              <CardHeader title={t("integrations.settings.title")} description={t(`integrations.providers.${info.key}.settingsHelp`)} />
              <div className="p-4">
                <ConnectionSettingsForm
                  base={base}
                  provider={info.key}
                  fields={info.configFields}
                  values={Object.fromEntries(info.configFields.filter((f) => !f.secret && typeof cfg[f.key] === "string").map((f) => [f.key, cfg[f.key] as string]))}
                  storedSecrets={secretNames}
                />
              </div>
            </Card>
          ) : null}

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

          {info.syncKinds?.length ? (
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
                <p>{t(`integrations.authTypes.${info.authType}`)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("integrations.powers")}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {info.capabilities.map((c) => (
                    <Badge key={c}>{t(`integrations.capabilities.${c}`)}</Badge>
                  ))}
                </div>
              </div>
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
