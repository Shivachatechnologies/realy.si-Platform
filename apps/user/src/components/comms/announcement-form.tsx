"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { isoToLocal, localToIso, useAction } from "./client";

interface Option {
  id: string;
  name: string;
}

export interface AnnouncementDraft {
  id?: string;
  title: string;
  body: string;
  audience: "ALL" | "DEPARTMENT" | "TEAM";
  audienceId: string | null;
  pinned: boolean;
  status?: string;
  publishAt?: string | null;
}

export function AnnouncementForm({ base, locale, departments, teams, initial }: { base: string; locale: string; departments: Option[]; teams: Option[]; initial?: AnnouncementDraft }) {
  const t = useT();
  const router = useRouter();
  const published = initial?.status === "PUBLISHED";
  const [f, setF] = useState({
    title: initial?.title ?? "",
    body: initial?.body ?? "",
    audience: initial?.audience ?? "ALL",
    audienceId: initial?.audienceId ?? "",
    pinned: initial?.pinned ?? false,
    mode: (initial?.status === "SCHEDULED" ? "schedule" : "draft") as "draft" | "now" | "schedule",
    publishAt: isoToLocal(initial?.publishAt),
  });
  const { busy, error, run } = useAction();
  const options = f.audience === "DEPARTMENT" ? departments : f.audience === "TEAM" ? teams : [];
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      title: f.title,
      body: f.body,
      audience: f.audience,
      audienceId: f.audience === "ALL" ? null : f.audienceId || null,
      pinned: f.pinned,
      ...(published ? {} : { mode: f.mode, publishAt: f.mode === "schedule" ? localToIso(f.publishAt) : undefined }),
    };
    void run(
      () => (initial?.id ? api(`${base}/comms/announcements/${initial.id}`, { method: "PATCH", body: payload }) : api<{ id: string }>(`${base}/comms/announcements`, { body: payload })),
      (r) => {
        const id = initial?.id ?? (r as { id: string }).id;
        router.push(`/${locale}/communication/announcements/${id}`);
      },
    );
  };
  return (
    <form onSubmit={submit} className="grid gap-3 p-4 sm:grid-cols-2">
      <Field label={t("communication.announcements.titleLabel")} htmlFor="ann-title" className="sm:col-span-2">
        <Input id="ann-title" required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </Field>
      <Field label={t("communication.announcements.body")} htmlFor="ann-body" hint={t("communication.markdownHint")} className="sm:col-span-2">
        <Textarea id="ann-body" required rows={8} maxLength={20000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
      </Field>
      <Field label={t("communication.announcements.audience")} htmlFor="ann-audience">
        <Select id="ann-audience" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value as typeof f.audience, audienceId: "" })}>
          {(["ALL", "DEPARTMENT", "TEAM"] as const).map((a) => (
            <option key={a} value={a}>
              {t(`communication.announcements.audiences.${a}`)}
            </option>
          ))}
        </Select>
      </Field>
      {f.audience !== "ALL" ? (
        <Field label={t(`communication.announcements.audiences.${f.audience}`)} htmlFor="ann-audience-id" hint={options.length ? undefined : t("communication.announcements.noGroups")}>
          <Select id="ann-audience-id" required value={f.audienceId} onChange={(e) => setF({ ...f, audienceId: e.target.value })}>
            <option value="">—</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <div />
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} />
        {t("communication.announcements.pin")}
      </label>
      {!published ? (
        <fieldset className="grid gap-2 sm:col-span-2">
          <legend className="text-sm font-medium">{t("communication.announcements.publishing")}</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {(["draft", "now", "schedule"] as const).map((m) => (
              <label key={m} className="flex items-center gap-2">
                <input type="radio" name="mode" checked={f.mode === m} onChange={() => setF({ ...f, mode: m })} />
                {t(`communication.announcements.modes.${m}`)}
              </label>
            ))}
          </div>
          {f.mode === "schedule" ? <Input type="datetime-local" required aria-label={t("communication.announcements.publishAt")} value={f.publishAt} onChange={(e) => setF({ ...f, publishAt: e.target.value })} className="max-w-xs" /> : null}
        </fieldset>
      ) : null}
      <div className="grid gap-2 sm:col-span-2">
        <FormError error={error} />
        <div>
          <Button type="submit" disabled={busy || !f.title.trim() || !f.body.trim()}>
            {initial?.id ? t("common.save") : f.mode === "now" ? t("communication.announcements.publishNow") : t("common.create")}
          </Button>
        </div>
      </div>
    </form>
  );
}
