import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { integrationsPage } from "@/components/integrations/frame";
import { RedeliverButton, SubscriptionRowActions } from "@/components/integrations/webhook-managers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { AppError } from "@/server/core/errors";
import { getSubscriptionWithDeliveries } from "@/server/modules/integrations/webhooks";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("integrations.webhooks.outgoing") };
}

const TONE = { PENDING: "warning", SUCCEEDED: "success", FAILED: "danger" } as const;

export default async function SubscriptionPage({ params, searchParams }: PageProps<"/[locale]/integrations/webhooks/subscriptions/[subscriptionId]">) {
  const { subscriptionId } = await params;
  const status = (await searchParams).status;
  const p = await integrationsPage("webhooks");
  if (p.page) return p.page;
  const { locale, t, viewer, org, company, canManage, tz, base } = p.ctx;
  const { subscription, deliveries } = await getSubscriptionWithDeliveries(viewer.ctx, org.id, company.id, subscriptionId, typeof status === "string" ? status : undefined).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  return p.render(
    <>
      <Link href={`/${locale}/integrations/webhooks`} className="text-sm text-muted-foreground hover:underline">
        ← {t("integrations.tabs.webhooks")}
      </Link>
      <Card>
        <CardHeader title={subscription.name} description={subscription.url} actions={<Badge tone={subscription.active ? "success" : "neutral"}>{subscription.active ? t("common.enabled") : t("common.disabled")}</Badge>} />
        <CardBody className="grid gap-3">
          <p className="text-sm">
            <span className="text-muted-foreground">{t("integrations.webhooks.events")}: </span>
            {subscription.eventTypes.includes("*") ? t("integrations.webhooks.allEvents") : subscription.eventTypes.join(", ")}
          </p>
          <p className="text-xs text-muted-foreground">{t("integrations.webhooks.signatureHelp")}</p>
          {canManage ? <SubscriptionRowActions base={base} id={subscription.id} active={subscription.active} /> : null}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("integrations.webhooks.deliveryLog")} description={t("integrations.webhooks.retryHelp")} />
        <form className="flex flex-wrap gap-2 border-b p-3" action={`/${locale}/integrations/webhooks/subscriptions/${subscription.id}`}>
          <Select name="status" defaultValue={typeof status === "string" ? status : ""} className="w-48" aria-label={t("common.status")}>
            <option value="">{t("common.all")}</option>
            {(["PENDING", "SUCCEEDED", "FAILED"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`integrations.webhooks.deliveryStatus.${s}`)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {t("integrations.applyFilters")}
          </Button>
        </form>
        {deliveries.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("integrations.webhooks.noDeliveries")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("integrations.webhooks.created")}</Th>
                <Th>{t("integrations.webhooks.event")}</Th>
                <Th>{t("common.status")}</Th>
                <Th className="text-end">{t("integrations.webhooks.attempts")}</Th>
                <Th>{t("integrations.webhooks.response")}</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {deliveries.map((d) => (
                <Tr key={d.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(d.createdAt, locale, tz)}</Td>
                  <Td>
                    <details>
                      <summary className="cursor-pointer font-mono text-xs">{d.eventType}</summary>
                      <pre className="mt-1 max-h-72 max-w-[32rem] overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs">{JSON.stringify(d.payload, null, 2)}</pre>
                    </details>
                  </Td>
                  <Td>
                    <Badge tone={TONE[d.status]}>{t(`integrations.webhooks.deliveryStatus.${d.status}`)}</Badge>
                    {d.status === "PENDING" && d.nextAttemptAt ? <p className="mt-1 text-xs text-muted-foreground">{t("integrations.webhooks.nextAttempt", { date: formatDateTime(d.nextAttemptAt, locale, tz) })}</p> : null}
                  </Td>
                  <Td className="text-end tabular-nums">{d.attempts}</Td>
                  <Td className="max-w-64 text-xs text-muted-foreground">
                    {d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : ""}
                    {d.lastError ? <span className="block truncate">{d.lastError}</span> : null}
                  </Td>
                  <Td className="text-end">{canManage ? <RedeliverButton base={base} deliveryId={d.id} /> : null}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>,
  );
}
