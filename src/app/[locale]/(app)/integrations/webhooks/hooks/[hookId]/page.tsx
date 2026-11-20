import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { integrationsPage } from "@/components/integrations/frame";
import { CopyText, HookRowActions } from "@/components/integrations/webhook-managers";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { AppError } from "@/server/core/errors";
import { getHookWithDeliveries } from "@/server/modules/integrations/webhooks";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("integrations.webhooks.incoming") };
}

export default async function HookPage({ params }: PageProps<"/[locale]/integrations/webhooks/hooks/[hookId]">) {
  const { hookId } = await params;
  const p = await integrationsPage("webhooks");
  if (p.page) return p.page;
  const { locale, t, viewer, org, company, canManage, tz, base } = p.ctx;
  const { hook, deliveries } = await getHookWithDeliveries(viewer.ctx, org.id, company.id, hookId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const curl =
    hook.verification === "TOKEN"
      ? `curl -X POST '${hook.url}' -H 'content-type: application/json' -H 'x-realy-token: <secret>' -d '{"name":"Ada","email":"ada@example.com"}'`
      : `body='{"name":"Ada"}'; sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac '<secret>' | cut -d' ' -f2)\ncurl -X POST '${hook.url}' -H 'content-type: application/json' -H "${hook.signatureHeader}: sha256=$sig" -d "$body"`;
  return p.render(
    <>
      <Link href={`/${locale}/integrations/webhooks`} className="text-sm text-muted-foreground hover:underline">
        ← {t("integrations.tabs.webhooks")}
      </Link>
      <Card>
        <CardHeader title={hook.name} description={t(`integrations.webhooks.verification${hook.verification}`)} actions={<Badge tone={hook.active ? "success" : "neutral"}>{hook.active ? t("common.enabled") : t("common.disabled")}</Badge>} />
        <CardBody className="grid gap-3">
          <CopyText value={hook.url} label={t("integrations.webhooks.copy")} />
          <div>
            <p className="mb-1 text-xs text-muted-foreground">{t("integrations.webhooks.example")}</p>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">{curl}</pre>
          </div>
          <p className="text-xs text-muted-foreground">{t("integrations.webhooks.workflowHint")}</p>
          {canManage ? <HookRowActions base={base} hookId={hook.id} active={hook.active} /> : null}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("integrations.webhooks.deliveries")} description={t("integrations.webhooks.deliveriesHelp")} />
        {deliveries.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("integrations.webhooks.noDeliveries")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("integrations.webhooks.received")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("integrations.webhooks.body")}</Th>
              </Tr>
            </THead>
            <TBody>
              {deliveries.map((d) => (
                <Tr key={d.id}>
                  <Td className="whitespace-nowrap align-top">{formatDateTime(d.receivedAt, locale, tz)}</Td>
                  <Td className="align-top">
                    <Badge tone={d.status === "ACCEPTED" ? "success" : "danger"}>{t(`integrations.webhooks.delivery${d.status}`)}</Badge>
                    {d.error ? <p className="mt-1 text-xs text-muted-foreground">{d.error}</p> : null}
                  </Td>
                  <Td className="max-w-[40rem]">
                    {d.body ? (
                      <details>
                        <summary className="cursor-pointer truncate font-mono text-xs">{d.body.slice(0, 120)}</summary>
                        <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs">{d.body}</pre>
                      </details>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>,
  );
}
