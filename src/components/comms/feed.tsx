"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ActionButton, Composer, InlineEdit, useAction, type Person } from "./client";
import { Markdownish } from "./markdownish";

export const REACTIONS = ["👍", "🎉", "❤️", "😂", "👀", "🙏"] as const;

export interface PostView {
  id: string;
  authorId: string;
  authorName: string | null;
  body: string;
  when: string;
  edited: boolean;
  commentCount: number;
  reactions: { emoji: string; count: number; mine: boolean }[];
}

interface CommentRow {
  id: string;
  authorId: string;
  authorName: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
}

/** Comments with @mentions on any record ("post", "announcement", "meeting"); loads on demand. */
export function CommentThread({ base, subjectType, subjectId, people, me, canPost, canManage }: { base: string; subjectType: string; subjectId: string; people: Person[]; me: string; canPost: boolean; canManage: boolean }) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<CommentRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const url = `${base}/comms/comments?subjectType=${subjectType}&subjectId=${subjectId}`;
  const load = useCallback(
    () =>
      api<{ data: CommentRow[] }>(url)
        .then((r) => setRows(r.data))
        .catch(setError),
    [url],
  );
  useEffect(() => {
    let alive = true;
    api<{ data: CommentRow[] }>(url)
      .then((r) => alive && setRows(r.data))
      .catch((err) => alive && setError(err));
    return () => {
      alive = false;
    };
  }, [url]);
  return (
    <div className="grid gap-3">
      <FormError error={error} />
      {rows === null ? <p className="text-xs text-muted-foreground">{t("common.loading")}</p> : null}
      {rows?.length === 0 ? <p className="text-xs text-muted-foreground">{t("communication.noComments")}</p> : null}
      <ul className="grid gap-3">
        {rows?.map((c) => (
          <li key={c.id} className="grid gap-1 border-s-2 ps-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{c.authorName ?? "?"}</span>
              <span>{new Date(c.createdAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}</span>
              {c.editedAt ? <span>· {t("communication.edited")}</span> : null}
              {c.authorId === me ? (
                <button type="button" className="hover:text-foreground" onClick={() => setEditing(c.id)} aria-label={t("communication.edit")}>
                  <Pencil className="size-3" />
                </button>
              ) : null}
              {c.authorId === me || canManage ? (
                <ActionButton path={`${base}/comms/comments/${c.id}`} method="DELETE" variant="ghost" confirm={t("communication.confirmDelete")} onDone={() => void load()} className="[&_button]:h-5 [&_button]:px-1">
                  <Trash2 className="size-3" aria-label={t("communication.delete")} />
                </ActionButton>
              ) : null}
            </div>
            {editing === c.id ? (
              <InlineEdit
                path={`${base}/comms/comments/${c.id}`}
                initial={c.body}
                people={people}
                onClose={() => {
                  setEditing(null);
                  void load();
                }}
              />
            ) : (
              <Markdownish text={c.body} />
            )}
          </li>
        ))}
      </ul>
      {canPost ? <Composer path={`${base}/comms/comments`} extraBody={{ subjectType, subjectId }} people={people} rows={2} placeholder={t("communication.commentPlaceholder")} submitLabel={t("communication.comment")} onPosted={() => void load()} /> : null}
    </div>
  );
}

export function PostCard({ base, post, people, me, canPost, canManage }: { base: string; post: PostView; people: Person[]; me: string; canPost: boolean; canManage: boolean }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction();
  const react = (emoji: string) => run(() => api(`${base}/comms/posts/${post.id}/reactions`, { body: { emoji } }));
  return (
    <article id={`post-${post.id}`} className="grid gap-2 border-b p-4 last:border-0">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="text-sm font-medium text-foreground">{post.authorName ?? "?"}</span>
        <span>{post.when}</span>
        {post.edited ? <span>· {t("communication.edited")}</span> : null}
        <span className="ms-auto flex gap-1">
          {post.authorId === me ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={t("communication.edit")}>
              <Pencil />
            </Button>
          ) : null}
          {post.authorId === me || canManage ? (
            <ActionButton path={`${base}/comms/posts/${post.id}`} method="DELETE" variant="ghost" confirm={t("communication.confirmDelete")}>
              <Trash2 aria-label={t("communication.delete")} />
            </ActionButton>
          ) : null}
        </span>
      </div>
      {editing ? <InlineEdit path={`${base}/comms/posts/${post.id}`} initial={post.body} people={people} onClose={() => setEditing(false)} /> : <Markdownish text={post.body} />}
      <div className="flex flex-wrap items-center gap-1">
        {REACTIONS.map((emoji) => {
          const r = post.reactions.find((x) => x.emoji === emoji);
          if (!r && !canPost) return null;
          return (
            <button
              key={emoji}
              type="button"
              disabled={busy}
              onClick={() => void react(emoji)}
              aria-pressed={!!r?.mine}
              className={cn("rounded-full border px-2 py-0.5 text-xs", r?.mine ? "border-primary bg-accent" : r ? "" : "opacity-50 hover:opacity-100")}
            >
              {emoji}
              {r ? <span className="ms-1 tabular-nums">{r.count}</span> : null}
            </button>
          );
        })}
        <Button type="button" size="sm" variant="ghost" className="ms-auto" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <MessageSquare aria-hidden />
          {t("communication.commentsCount", { count: post.commentCount })}
        </Button>
      </div>
      <FormError error={error} />
      {open ? <CommentThread base={base} subjectType="post" subjectId={post.id} people={people} me={me} canPost={canPost} canManage={canManage} /> : null}
    </article>
  );
}
