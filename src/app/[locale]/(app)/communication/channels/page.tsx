import type { Metadata } from "next";
import Link from "next/link";
import { Hash, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NewChannelForm } from "@/components/comms/channels";
import { EmptyState } from "@/components/comms/bits";
import { areaPage } from "@/components/comms/context";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { listChannels } from "@/server/modules/comms/channels";
import { listPeople } from "@/server/modules/comms/common";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("communication.channels.title") };
}

export default async function ChannelsPage({ searchParams }: PageProps<"/[locale]/communication/channels">) {
  const p = await areaPage("communication", "channels");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, base, perms, wrap } = p;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 200) : "";
  const archived = sp.archived === "1";
  const [channels, people] = await Promise.all([listChannels(viewer.ctx, org.id, company.id, { q: q || undefined, archived }), listPeople(viewer.ctx, org.id, company.id)]);
  const path = `/${locale}/communication/channels`;
  return wrap(
    <div className="grid gap-4">
      {perms.post ? (
        <Card>
          <details>
            <summary className="cursor-pointer p-4 text-sm font-medium">{t("communication.channels.new")}</summary>
            <NewChannelForm base={base} locale={locale} people={people.map((u) => ({ id: u.id, name: u.name }))} me={viewer.user.id} />
          </details>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("communication.channels.title")} description={t("communication.channels.description")} actions={<Link href={archived ? path : `${path}?archived=1`} className="text-xs hover:underline">{archived ? t("communication.channels.showActive") : t("communication.channels.showArchived")}</Link>} />
        <form className="flex gap-2 border-b p-3" action={path}>
          {archived ? <input type="hidden" name="archived" value="1" /> : null}
          <Input name="q" type="search" defaultValue={q} maxLength={200} placeholder={t("communication.channels.search")} aria-label={t("communication.channels.search")} />
          <Button type="submit" variant="secondary">
            {t("communication.search")}
          </Button>
        </form>
        {channels.length === 0 ? (
          <EmptyState>{q ? t("common.noResults") : t("communication.channels.empty")}</EmptyState>
        ) : (
          <ul className="grid divide-y">
            {channels.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                {c.visibility === "PRIVATE" ? <Lock className="size-4 text-muted-foreground" aria-label={t("communication.channels.private")} /> : <Hash className="size-4 text-muted-foreground" aria-hidden />}
                <Link href={`${path}/${c.id}`} className="font-medium hover:underline">
                  {c.name}
                </Link>
                {c.unread ? <Badge tone="accent">{t("communication.unreadCount", { count: c.unread })}</Badge> : null}
                {!c.member ? <Badge>{t("communication.channels.notMember")}</Badge> : null}
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{c.description}</span>
                <span className="text-xs text-muted-foreground">
                  {t("communication.channels.membersCount", { count: c.memberCount })}
                  {c.lastMessageAt ? ` · ${formatDateTime(c.lastMessageAt, locale, tz)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>,
  );
}
