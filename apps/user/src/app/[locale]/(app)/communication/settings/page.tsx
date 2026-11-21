import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionButton } from "@/components/comms/client";
import { MailboxForm, SyncMailboxButton, TemplateForm, TemplateRow } from "@/components/comms/inbox";
import { EmptyState } from "@/components/comms/bits";
import { areaPage } from "@/components/comms/context";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { COMMS_PROVIDERS, connectionStatuses } from "@/server/modules/comms/connections-bridge";
import { listEmailAccounts, listTemplates } from "@/server/modules/comms/email";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("communication.settings.title") };
}

const TONE = { CONNECTED: "success", ERROR: "danger", DISCONNECTED: "neutral" } as const;

export default async function CommsSettingsPage() {
  const p = await areaPage("communication", "settings");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, base, perms, wrap } = p;
  const [accounts, templates, conns] = await Promise.all([listEmailAccounts(viewer.ctx, org.id, company.id), listTemplates(viewer.ctx, org.id, company.id), connectionStatuses(org.id, company.id)]);
  return wrap(
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title={t("communication.settings.connections")} description={t("communication.settings.connectionsHint")} actions={<Link className="text-xs hover:underline" href={`/${locale}/integrations`}>{t("communication.connectIntegrations")}</Link>} />
        <ul className="grid divide-y">
          {COMMS_PROVIDERS.map((pr) => (
            <li key={pr} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
              <span>
                {t(`communication.providers.${pr}`)}
                <span className="block text-xs text-muted-foreground">{t(`communication.settings.uses.${pr}`)}</span>
              </span>
              <Badge tone={TONE[conns[pr]]}>{t(`communication.settings.connection.${conns[pr]}`)}</Badge>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title={t("communication.settings.mailboxes")} description={t("communication.settings.mailboxesHint")} />
        {accounts.length ? (
          <ul className="grid divide-y">
            {accounts.map((a) => (
              <li key={a.id} className="grid gap-1 px-4 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.address}</span>
                  <Badge>{t(`communication.providers.${a.provider}`)}</Badge>
                  <Badge tone={TONE[a.connection as keyof typeof TONE]}>{t(`communication.settings.connection.${a.connection}`)}</Badge>
                  {perms.manage ? (
                    <span className="ms-auto flex gap-1">
                      {a.connection === "CONNECTED" ? <SyncMailboxButton base={base} id={a.id} /> : null}
                      <ActionButton path={`${base}/comms/email/accounts/${a.id}`} method="DELETE" variant="ghost" confirm={t("communication.settings.confirmRemoveMailbox")}>
                        {t("communication.settings.remove")}
                      </ActionButton>
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-muted-foreground">
                  {a.lastSyncedAt ? t("communication.settings.lastSynced", { date: formatDateTime(a.lastSyncedAt, locale, tz) }) : t("communication.settings.neverSynced")}
                  {a.syncError ? ` · ${a.syncError}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>{t("communication.settings.noMailboxes")}</EmptyState>
        )}
        {perms.manage ? (
          <CardBody className="border-t">
            <MailboxForm base={base} />
          </CardBody>
        ) : null}
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title={t("communication.settings.templates")} description={t("communication.settings.templatesHint")} />
        {templates.length ? (
          <ul className="grid divide-y">{perms.manage ? templates.map((tpl) => <TemplateRow key={tpl.id} base={base} template={tpl} />) : templates.map((tpl) => <li key={tpl.id} className="px-4 py-2 text-sm">{tpl.name} — <span className="text-muted-foreground">{tpl.subject}</span></li>)}</ul>
        ) : (
          <EmptyState>{t("communication.settings.noTemplates")}</EmptyState>
        )}
        {perms.manage ? (
          <CardBody className="border-t">
            <TemplateForm base={base} />
          </CardBody>
        ) : null}
      </Card>
    </div>,
  );
}
