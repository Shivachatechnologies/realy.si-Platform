"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageSquareReply, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { ActionButton, InlineEdit, PeoplePicker, useAction, type Person } from "./client";
import { Markdownish } from "./markdownish";

export function NewChannelForm({ base, locale, people, me }: { base: string; locale: string; people: Person[]; me: string }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState({ name: "", description: "", visibility: "PUBLIC" as "PUBLIC" | "PRIVATE", memberIds: [] as string[] });
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-3 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api<{ id: string }>(`${base}/comms/channels`, { body: f }), (r) => router.push(`/${locale}/communication/channels/${r.id}`));
      }}
    >
      <Field label={t("communication.channels.name")} htmlFor="ch-name">
        <Input id="ch-name" required maxLength={80} value={f.name} placeholder="product-launch" onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <Field label={t("communication.channels.visibility")} htmlFor="ch-vis">
        <Select id="ch-vis" value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value as "PUBLIC" | "PRIVATE" })}>
          <option value="PUBLIC">{t("communication.channels.public")}</option>
          <option value="PRIVATE">{t("communication.channels.private")}</option>
        </Select>
      </Field>
      <Field label={t("communication.channels.descriptionLabel")} htmlFor="ch-desc" className="sm:col-span-2">
        <Input id="ch-desc" maxLength={500} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
      <div className="grid gap-1.5 sm:col-span-2">
        <span className="text-sm font-medium">{t("communication.channels.members")}</span>
        <PeoplePicker people={people} value={f.memberIds} onChange={(memberIds) => setF({ ...f, memberIds })} exclude={[me]} />
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <FormError error={error} />
        <div>
          <Button type="submit" disabled={busy || !f.name.trim()}>
            <Plus aria-hidden />
            {t("communication.channels.create")}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function StartDirect({ base, locale, people }: { base: string; locale: string; people: Person[] }) {
  const t = useT();
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        if (userId) void run(() => api<{ id: string }>(`${base}/comms/direct`, { body: { userId } }), (r) => router.push(`/${locale}/communication/messages/${r.id}`));
      }}
    >
      <Select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label={t("communication.messages.choosePerson")} required>
        <option value="">{t("communication.messages.choosePerson")}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Button type="submit" disabled={busy || !userId}>
        {t("communication.messages.start")}
      </Button>
      <div className="sm:col-span-2">
        <FormError error={error} />
      </div>
    </form>
  );
}

export interface MessageView {
  id: string;
  authorId: string;
  authorName: string | null;
  body: string;
  when: string;
  edited: boolean;
  deleted: boolean;
  replyCount: number;
}

export function MessageItem({ base, m, people, me, canManage, threadHref }: { base: string; m: MessageView; people: Person[]; me: string; canManage: boolean; threadHref?: string }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  return (
    <li className="group grid gap-1 px-4 py-2 hover:bg-muted/40">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="text-sm font-medium text-foreground">{m.authorName ?? "?"}</span>
        <span>{m.when}</span>
        {m.edited && !m.deleted ? <span>· {t("communication.edited")}</span> : null}
        {!m.deleted ? (
          <span className="ms-auto flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
            {m.authorId === me ? (
              <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setEditing(true)} aria-label={t("communication.edit")}>
                <Pencil />
              </Button>
            ) : null}
            {m.authorId === me || canManage ? (
              <ActionButton path={`${base}/comms/messages/${m.id}`} method="DELETE" variant="ghost" confirm={t("communication.confirmDelete")} className="[&_button]:h-6 [&_button]:px-1.5">
                <Trash2 aria-label={t("communication.delete")} />
              </ActionButton>
            ) : null}
          </span>
        ) : null}
      </div>
      {m.deleted ? (
        <p className="text-sm italic text-muted-foreground">{t("communication.messages.deleted")}</p>
      ) : editing ? (
        <InlineEdit path={`${base}/comms/messages/${m.id}`} initial={m.body} people={people} onClose={() => setEditing(false)} />
      ) : (
        <Markdownish text={m.body} />
      )}
      {threadHref && !m.deleted ? (
        <Link href={threadHref} className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
          <MessageSquareReply className="size-3.5" aria-hidden />
          {m.replyCount ? t("communication.messages.replies", { count: m.replyCount }) : t("communication.messages.reply")}
        </Link>
      ) : null}
    </li>
  );
}

export function ChannelSettings({ base, locale, channel, canDelete }: { base: string; locale: string; channel: { id: string; name: string; description: string | null; visibility: "PUBLIC" | "PRIVATE"; archived: boolean }; canDelete: boolean }) {
  const t = useT();
  const [f, setF] = useState({ name: channel.name, description: channel.description ?? "", visibility: channel.visibility });
  const { busy, error, run } = useAction();
  const path = `${base}/comms/channels/${channel.id}`;
  return (
    <div className="grid gap-3">
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => api(path, { method: "PATCH", body: f }));
        }}
      >
        <Input aria-label={t("communication.channels.name")} required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input aria-label={t("communication.channels.descriptionLabel")} maxLength={500} value={f.description} placeholder={t("communication.channels.descriptionLabel")} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <Select aria-label={t("communication.channels.visibility")} value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value as "PUBLIC" | "PRIVATE" })}>
          <option value="PUBLIC">{t("communication.channels.public")}</option>
          <option value="PRIVATE">{t("communication.channels.private")}</option>
        </Select>
        <FormError error={error} />
        <div>
          <Button type="submit" size="sm" disabled={busy}>
            {t("common.save")}
          </Button>
        </div>
      </form>
      <div className="flex flex-wrap gap-2">
        <ActionButton path={path} method="PATCH" body={{ archived: !channel.archived }}>
          {channel.archived ? t("communication.unarchive") : t("communication.archive")}
        </ActionButton>
        {canDelete ? (
          <ActionButton path={path} method="DELETE" variant="danger" confirm={t("communication.confirmDelete")} redirectTo={`/${locale}/communication/channels`}>
            {t("communication.delete")}
          </ActionButton>
        ) : null}
      </div>
    </div>
  );
}

export function AddMembers({ base, channelId, people, existing }: { base: string; channelId: string; people: Person[]; existing: string[] }) {
  const t = useT();
  const [ids, setIds] = useState<string[]>([]);
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-2">
      <PeoplePicker people={people} value={ids} onChange={setIds} exclude={existing} />
      <FormError error={error} />
      <div>
        <Button type="button" size="sm" disabled={busy || !ids.length} onClick={() => void run(() => api(`${base}/comms/channels/${channelId}/members`, { body: { userIds: ids } }), () => setIds([]))}>
          {t("communication.channels.addMembers")}
        </Button>
      </div>
    </div>
  );
}
