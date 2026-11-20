"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./client";

export interface TaskDiscussionState {
  href: string;
  channelName: string | null;
  visible: boolean;
  replies: number;
}

/**
 * "Discuss in channel" on a WorkTask: opens the linked channel thread, or starts one in a chosen channel.
 * The task's own comments stay its in-place discussion; this links a team channel thread to it.
 */
export function DiscussInChannel({ base, locale, taskId, discussion, channels, canPost }: {
  base: string;
  locale: string;
  taskId: string;
  discussion: TaskDiscussionState | null;
  channels: { id: string; name: string }[];
  canPost: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [note, setNote] = useState("");
  const { busy, error, run } = useAction();

  if (discussion) {
    return discussion.visible ? (
      <Link href={`/${locale}${discussion.href}`} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm hover:bg-muted">
        <MessagesSquare className="size-4" aria-hidden />
        {t("communication.tasks.openDiscussion", { channel: discussion.channelName ?? "" })}
        <span className="text-xs text-muted-foreground">· {t("communication.messages.replies", { count: discussion.replies })}</span>
      </Link>
    ) : (
      <span className="text-xs text-muted-foreground">{t("communication.tasks.privateDiscussion")}</span>
    );
  }
  if (!canPost) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="secondary">
          <MessagesSquare aria-hidden />
          {t("communication.tasks.discuss")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("communication.tasks.discuss")} description={t("communication.tasks.discussHint")} closeLabel={t("common.close")}>
        {channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("communication.tasks.noChannels")}{" "}
            <Link className="underline" href={`/${locale}/communication/channels`}>
              {t("communication.tasks.createChannel")}
            </Link>
          </p>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () => api<{ channelId: string; messageId: string }>(`${base}/comms/tasks/${taskId}/discussion`, { body: { channelId, note: note.trim() || undefined } }),
                (r) => {
                  setOpen(false);
                  if (r) router.push(`/${locale}/communication/channels/${r.channelId}?thread=${r.messageId}`);
                },
              );
            }}
          >
            <Field label={t("communication.tasks.channel")} htmlFor="td-channel">
              <Select id="td-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} required>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("communication.tasks.note")} htmlFor="td-note">
              <Textarea id="td-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <FormError error={error} />
            <div>
              <Button type="submit" disabled={busy || !channelId}>
                {t("communication.tasks.start")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
