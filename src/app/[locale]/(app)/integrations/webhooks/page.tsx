import type { Metadata } from "next";
import Link from "next/link";
import { eventLabelKey } from "@/components/automation/labels";
import { integrationsPage } from "@/components/integrations/frame";
import { CopyText, HookRowActions, NewHookForm, NewSubscriptionForm, SubscriptionRowActions } from "@/components/integrations/webhook-managers";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { listHooks, listSubscriptions, OUTBOUND_EVENT_TYPES } from "@/server/modules/integrations/webhooks";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("integrations.tabs.webhooks") };
}

export default async function WebhooksPage() {
  const p = await integrationsPage("webhooks");
  if (p.page) return p.page;
  const { locale, t, viewer, org, company, canManage, tz, base } = p.ctx;
  const [hooks, subs] = await Promise.all([listHooks(viewer.ctx, org.id, company.id), listSubscriptions(viewer.ctx, org.id, company.id)]);
  const eventLabels = Object.fromEntries(OUTBOUND_EVENT_TYPES.map((e) => [e, t(eventLabelKey(e))]));
  return p.render(
    <>
      <Card>
        <CardHeader title={t("integrations.webhooks.incoming")} description={t("integrations.webhooks.incomingHelp")} />
        {canManage ? <NewHookForm base={base} /> : null}
        {hooks.length === 0 ? (
          <p className="border-t p-4 text-muted-foreground">{t("integrations.webhooks.noHooks")}</p>
        ) : (
          <ul className="divide-y border-t">
            {hooks.map((h) => (
              <li key={h.id} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="grid min-w-0 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/${locale}/integrations/webhooks/hooks/${h.id}`} className="font-medium hover:underline">
                      {h.name}
                    </Link>
                    <Badge tone={h.active ? "success" : "neutral"}>{h.active ? t("common.enabled") : t("common.disabled")}</Badge>
                  </div>
                  <CopyText value={h.url} label={t("integrations.webhooks.copy")} />
                  <p className="text-xs text-muted-foreground">
                    {t(`integrations.webhooks.verification${h.verification}`)} · {t("integrations.webhooks.deliveryCount", { count: h._count.deliveries })}
                    {h.lastReceivedAt ? ` · ${t("integrations.webhooks.lastReceived", { date: formatDateTime(h.lastReceivedAt, locale, tz) })}` : ""}
                  </p>
                </div>
                {canManage ? <HookRowActions base={base} hookId={h.id} active={h.active} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title={t("integrations.webhooks.outgoing")} description={t("integrations.webhooks.outgoingHelp")} />
        {canManage ? (
          <details className="border-b">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("integrations.webhooks.createSubscription")}</summary>
            <NewSubscriptionForm base={base} eventTypes={[...OUTBOUND_EVENT_TYPES]} eventLabels={eventLabels} />
          </details>
        ) : null}
        {subs.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("integrations.webhooks.noSubscriptions")}</p>
        ) : (
          <ul className="divide-y">
            {subs.map((s) => (
              <li key={s.id} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="grid min-w-0 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/${locale}/integrations/webhooks/subscriptions/${s.id}`} className="font-medium hover:underline">
                      {s.name}
                    </Link>
                    <Badge tone={s.active ? "success" : "neutral"}>{s.active ? t("common.enabled") : t("common.disabled")}</Badge>
                    {s.failedDeliveries ? <Badge tone="danger">{t("integrations.webhooks.failedCount", { count: s.failedDeliveries })}</Badge> : null}
                  </div>
                  <p className="truncate font-mono text-xs text-muted-foreground">{s.url}</p>
                  <p className="text-xs text-muted-foreground">{s.eventTypes.includes("*") ? t("integrations.webhooks.allEvents") : s.eventTypes.map((e) => eventLabels[e] ?? e).join(", ")}</p>
                </div>
                {canManage ? <SubscriptionRowActions base={base} id={s.id} active={s.active} /> : null}
              </li>
            ))}
          </ul>
        )}
        <div className="border-t p-3 text-xs text-muted-foreground">{t("integrations.webhooks.signatureHelp")}</div>
      </Card>
    </>,
  );
}
