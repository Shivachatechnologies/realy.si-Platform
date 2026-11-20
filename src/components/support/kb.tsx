"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { ActionButton, useAction } from "@/components/comms/client";

interface Option {
  id: string;
  name: string;
}

export interface ArticleDraft {
  id: string;
  title: string;
  body: string;
  categoryId: string | null;
  status: "DRAFT" | "PUBLISHED";
  tags: string[];
}

export function ArticleForm({ base, locale, categories, initial }: { base: string; locale: string; categories: Option[]; initial?: ArticleDraft }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState({ title: initial?.title ?? "", body: initial?.body ?? "", categoryId: initial?.categoryId ?? "", status: initial?.status ?? "DRAFT", tags: initial?.tags.join(", ") ?? "" });
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-3 p-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        const body = { title: f.title, body: f.body, categoryId: f.categoryId || null, status: f.status, tags: f.tags.split(",").map((x) => x.trim()).filter(Boolean) };
        void run(
          () => (initial ? api(`${base}/support/kb/articles/${initial.id}`, { method: "PATCH", body }) : api<{ id: string }>(`${base}/support/kb/articles`, { body })),
          (r) => {
            if (!initial) router.push(`/${locale}/support/knowledge/${(r as { id: string }).id}`);
          },
        );
      }}
    >
      <Field label={t("support.kb.articleTitle")} htmlFor="kb-title" className="sm:col-span-3">
        <Input id="kb-title" required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </Field>
      <Field label={t("support.kb.category")} htmlFor="kb-cat">
        <Select id="kb-cat" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
          <option value="">{t("support.kb.uncategorized")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("common.status")} htmlFor="kb-status">
        <Select id="kb-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as "DRAFT" | "PUBLISHED" })}>
          <option value="DRAFT">{t("support.kb.statuses.DRAFT")}</option>
          <option value="PUBLISHED">{t("support.kb.statuses.PUBLISHED")}</option>
        </Select>
      </Field>
      <Field label={t("support.ticket.tags")} htmlFor="kb-tags" hint={t("support.ticket.tagsHint")}>
        <Input id="kb-tags" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />
      </Field>
      <Field label={t("support.kb.body")} htmlFor="kb-body" hint={t("communication.markdownHint")} className="sm:col-span-3">
        <Textarea id="kb-body" required rows={14} maxLength={100000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} className="font-mono text-[13px]" />
      </Field>
      <div className="grid gap-2 sm:col-span-3">
        <FormError error={error} />
        <div>
          <Button type="submit" disabled={busy || !f.title.trim() || !f.body.trim()}>
            {initial ? t("common.save") : t("support.kb.create")}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function KbCategories({ base, categories, canManage }: { base: string; categories: (Option & { description: string | null; count: number })[]; canManage: boolean }) {
  const t = useT();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-2">
      <ul className="grid divide-y">
        {categories.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
            {editing === c.id ? (
              <form
                className="flex flex-1 gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => api(`${base}/support/kb/categories/${c.id}`, { method: "PATCH", body: { name: draft } }), () => setEditing(null));
                }}
              >
                <Input value={draft} maxLength={100} onChange={(e) => setDraft(e.target.value)} aria-label={t("support.kb.categoryName")} className="h-8" />
                <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
                  {t("common.save")}
                </Button>
              </form>
            ) : (
              <>
                <span className="flex-1">{c.name}</span>
                <span className="text-xs text-muted-foreground">{t("support.kb.articlesCount", { count: c.count })}</span>
                {canManage ? (
                  <>
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(c.id); setDraft(c.name); }}>
                      {t("communication.edit")}
                    </Button>
                    <ActionButton path={`${base}/support/kb/categories/${c.id}`} method="DELETE" variant="ghost" confirm={t("support.kb.confirmDeleteCategory")}>
                      {t("communication.delete")}
                    </ActionButton>
                  </>
                ) : null}
              </>
            )}
          </li>
        ))}
        {!categories.length ? <li className="py-1.5 text-sm text-muted-foreground">{t("support.kb.noCategories")}</li> : null}
      </ul>
      {canManage ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api(`${base}/support/kb/categories`, { body: { name } }), () => setName(""));
          }}
        >
          <Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder={t("support.kb.categoryName")} aria-label={t("support.kb.categoryName")} className="h-8" />
          <Button type="submit" size="sm" variant="secondary" disabled={busy || !name.trim()}>
            <Plus aria-hidden />
          </Button>
        </form>
      ) : null}
      <FormError error={error} />
    </div>
  );
}
