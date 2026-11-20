import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { StartDirect } from "@/components/comms/channels";
import { EmptyState } from "@/components/comms/bits";
import { areaPage } from "@/components/comms/context";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { listChannels } from "@/server/modules/comms/channels";
import { listPeople } from "@/server/modules/comms/common";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("communication.messages.title") };
}

export default async function DirectMessagesPage() {
  const p = await areaPage("communication", "messages");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, base, perms, wrap } = p;
  const [conversations, people] = await Promise.all([listChannels(viewer.ctx, org.id, company.id, { direct: true }), listPeople(viewer.ctx, org.id, company.id)]);
  return wrap(
    <Card>
      <CardHeader title={t("communication.messages.title")} description={t("communication.messages.description")} />
      {perms.post ? <StartDirect base={base} locale={locale} people={people.filter((u) => u.id !== viewer.user.id).map((u) => ({ id: u.id, name: u.name }))} /> : null}
      {conversations.length === 0 ? (
        <EmptyState>{t("communication.messages.none")}</EmptyState>
      ) : (
        <ul className="grid divide-y border-t">
          {conversations.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
              <Link href={`/${locale}/communication/messages/${c.id}`} className="font-medium hover:underline">
                {c.name}
              </Link>
              {c.unread ? <Badge tone="accent">{t("communication.unreadCount", { count: c.unread })}</Badge> : null}
              <span className="ms-auto text-xs text-muted-foreground">{c.lastMessageAt ? formatDateTime(c.lastMessageAt, locale, tz) : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>,
  );
}
