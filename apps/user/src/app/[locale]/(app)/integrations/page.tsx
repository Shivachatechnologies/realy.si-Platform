import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Compass, KeyRound, ShieldCheck } from "lucide-react";
import { Marketplace, type MarketplaceItem, type MarketplaceState } from "@/components/integrations/marketplace";
import { integrationTabLabels, IntegrationsTabs } from "@/components/integrations/tabs";
import { WorkerStatusNotice } from "@/components/integrations/worker-status";
import { Forbidden, NoCompany, Stat } from "@/components/automation/page-frame";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { workerHealth } from "@/server/core/job-admin";
import { integrationsHealth, listIntegrations, usageSummary } from "@/server/modules/integrations/service";
import { customerConnectMode } from "@/server/modules/integrations/catalog";
import { formatCostMicros } from "@/components/integrations/usage-format";
import { formatNumber, formatRelativeTime } from "@/i18n/format";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";
import { requestTime } from "@/server/session";
import { Section } from "@/components/ui/scene";
import { PageHeader } from "@/components/ui/page-header";
import { ProviderConstellation } from "@/components/graphics/provider-constellation";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.integrations.title") };
}

type Listed = Awaited<ReturnType<typeof listIntegrations>>[number];

/** Connected only when the provider accepted the credentials (test, health check or a successful call) with no error pending. */
function stateOf(i: Listed): MarketplaceState {
  // Platform-managed providers are read-only for customers: available on the platform's account, or not yet.
  if (i.platform) return i.platform === "available" ? "platform_available" : "platform_unavailable";
  if (i.info.availability === "awaiting_docs") return "awaiting_docs";
  // Switched off platform-wide by the admin: not connectable (an existing connection is not used either).
  if (i.disabled) return "disabled";
  // Customers only connect their own accounts with OAuth; other providers show the status of an existing connection.
  const mode = customerConnectMode(i.info);
  if (i.status === "ERROR") return "failing";
  if (i.status === "CONNECTED") {
    if (i.info.key === "webhook") return "verified";
    const c = i.connection;
    const tested = c && !c.lastError && (c.lastTestedAt || c.lastSuccessAt);
    // Providers without an identity API (SIP trunks) can only be "configured", never "verified".
    return tested ? (i.info.verification === "config_only" ? "configured" : "verified") : "unverified";
  }
  if (mode === "oauth") return i.oauthAvailable ? "ready" : "platform_setup";
  return "unavailable";
}

const latest = (a: Date | null | undefined, b: Date | null | undefined) => (a && b ? (a > b ? a : b) : (a ?? b ?? null));

export default async function IntegrationsPage({ searchParams }: PageProps<"/[locale]/integrations">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const frame = (children: React.ReactNode) => (
    <div className="mx-auto grid max-w-[1400px] gap-6">
      <PageHeader variant="editorial" world="integrations" eyebrow={t("dna.worlds.integrations")} title={t("modules.integrations.title")} description={t("integrations.subtitle")} />
      {children}
    </div>
  );
  if (!company) return frame(<NoCompany message={t("company.empty")} />);
  const chain = await companyChain(db(), org.id, company.id);
  if (!(await can(viewer.ctx, "integrations.read", chain))) return frame(<Forbidden message={t("errors.forbidden")} />);
  const view = (await searchParams).view === "connected" ? "connected" : "all";
  const list = await listIntegrations(viewer.ctx, org.id, company.id);
  const [{ syncErrors, failedDeliveries }, usage, worker] = await Promise.all([integrationsHealth(viewer.ctx, org.id, company.id), usageSummary(viewer.ctx, org.id, company.id, { days: 30 }), workerHealth()]);
  const now = requestTime();
  const items: MarketplaceItem[] = list.map((i) => {
    const state = stateOf(i);
    const verifiedAt = latest(i.connection?.lastTestedAt, i.connection?.lastSuccessAt);
    return {
      key: i.info.key,
      name: i.info.name,
      category: i.info.category,
      authType: i.info.authType,
      status: i.status === "CONNECTED" || i.status === "ERROR" ? i.status : null,
      account: i.connection?.status !== "DISCONNECTED" ? (i.connection?.externalAccount ?? null) : null,
      configured: i.configured || i.oauthAvailable,
      state,
      capabilities: i.info.capabilities,
      verifiedLabel: state === "verified" && verifiedAt ? t("integrations.marketplace.verifiedAgo", { time: formatRelativeTime(verifiedAt, locale, now) }) : null,
      plan: i.plan,
    };
  });
  const verified = items.filter((i) => i.state === "verified" || i.state === "configured").length;
  const attention = items.filter((i) => i.state === "failing" || i.state === "unverified").length;
  const guide = [
    { icon: Compass, title: t("integrations.guide.whatTitle"), body: t("integrations.guide.what") },
    { icon: ShieldCheck, title: t("integrations.guide.whyTitle"), body: t("integrations.guide.why") },
    { icon: Bot, title: t("integrations.guide.aiTitle"), body: t("integrations.guide.ai") },
    { icon: KeyRound, title: t("integrations.guide.nextTitle"), body: attention ? t("integrations.guide.nextFix", { count: attention }) : verified ? t("integrations.guide.nextMore") : t("integrations.guide.nextFirst") },
  ];
  return frame(
    <>
      <IntegrationsTabs locale={locale} active={view === "connected" ? "connected" : "marketplace"} labels={integrationTabLabels(t)} />
      <WorkerStatusNotice state={worker.state} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Stat label={t("integrations.marketplace.verifiedStat")} value={verified} hint={t("integrations.ofAvailable", { count: items.length })} />
        <Stat label={t("integrations.failing")} value={attention} hint={attention ? t("integrations.marketplace.attentionHint") : undefined} />
        <Stat label={t("integrations.metrics.syncErrors")} value={syncErrors} hint={t("integrations.last30Days")} />
        <Stat label={t("integrations.metrics.webhookFailures")} value={failedDeliveries} hint={t("integrations.last30Days")} />
        <Stat label={t("integrations.usage.calls")} value={formatNumber(usage.totals.calls, locale)} hint={t("integrations.usage.failedHint", { count: usage.totals.failed })} />
        <Stat label={t("integrations.usage.estimatedCost")} value={formatCostMicros(usage.totals.costMicros, locale)} hint={t("integrations.last30Days")} />
      </div>
      <ol className="grid gap-px overflow-hidden rounded-3xl border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {guide.map((g, idx) => (
          <li key={g.title} className="grid content-start gap-2 bg-surface p-4">
            <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <span aria-hidden className="font-mono tabular-nums">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <g.icon aria-hidden className="size-3.5 text-primary" />
              {g.title}
            </span>
            <p className="text-sm">{g.body}</p>
          </li>
        ))}
      </ol>
      <Section
        eyebrow={t("dna.integrations.eyebrow")}
        title={t("dna.integrations.title")}
        description={t("dna.integrations.description", { connected: verified, total: items.length })}
        action={
          <Link href={`/${locale}/integrations/usage`} className="inline-flex min-h-11 items-center text-sm text-primary hover:underline sm:min-h-0">
            {t("integrations.marketplace.usageLink")}
          </Link>
        }
      >
        <div className="overflow-hidden rounded-3xl border bg-[radial-gradient(ellipse_at_center,var(--world-soft),var(--surface)_75%)] p-3">
          <ProviderConstellation
            companyName={company.name}
            providers={items.map((i) => ({
              key: i.key,
              name: i.name,
              category: i.category,
              categoryLabel: t(`integrations.categories.${i.category}`),
              // Only verified connections light up as connected; failing and unverified ones show as needing attention.
              status: i.state === "verified" || i.state === "configured" ? "CONNECTED" : i.state === "failing" || i.state === "unverified" ? "ERROR" : null,
              href: `/${locale}/integrations/${i.key}`,
            }))}
          />
        </div>
      </Section>
      <Marketplace key={view} locale={locale} items={items} initialView={view} />
    </>,
  );
}
