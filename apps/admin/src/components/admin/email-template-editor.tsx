"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Eye, Rocket, Save, Send, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { ActionDialog } from "./action-dialog";

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");

/** Subject/body editor with variables, live preview (sample values), save, publish / unpublish and test-send. */
export function EmailTemplateEditor({
  templateKey,
  locale,
  initial,
  vars,
  sample,
  published,
  configured,
  canManage,
}: {
  templateKey: string;
  locale: string;
  initial: { subject: string; body: string };
  vars: string[];
  sample: Record<string, string>;
  published: boolean;
  configured: boolean;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [to, setTo] = useState("");
  const [sent, setSent] = useState(false);
  const path = `/api/v1/admin/email-templates/${encodeURIComponent(templateKey)}/${locale}`;
  const preview = useMemo(() => ({ subject: fill(subject, sample), paragraphs: fill(body, sample).split(/\n{2,}/).filter((p) => p.trim()) }), [subject, body, sample]);
  const unknown = [...new Set([...(subject + body).matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]!))].filter((v) => !vars.includes(v));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: "PUT", body: { subject, body } });
      setDirty(false);
      router.refresh();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title={t("admin.emailTemplates.editor")}
          description={t("admin.emailTemplates.variablesHint")}
          actions={published ? <Badge tone="success">{t("admin.emailTemplates.published")}</Badge> : <Badge tone="neutral">{t("admin.emailTemplates.builtIn")}</Badge>}
        />
        <fieldset disabled={!canManage} className="grid gap-3 p-3">
          <div className="flex flex-wrap gap-1">
            {vars.map((v) => (
              <button key={v} type="button" onClick={() => (setBody((b) => `${b}{{${v}}}`), setDirty(true))} className="rounded-sm border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] hover:border-primary/50">
                {`{{${v}}}`}
              </button>
            ))}
          </div>
          <Field label={t("admin.emailTemplates.subject")} htmlFor="et-subject">
            <Input id="et-subject" value={subject} maxLength={200} onChange={(e) => (setSubject(e.target.value), setDirty(true))} />
          </Field>
          <Field label={t("admin.emailTemplates.body")} htmlFor="et-body" hint={t("admin.emailTemplates.bodyHint")}>
            <Textarea id="et-body" rows={14} value={body} onChange={(e) => (setBody(e.target.value), setDirty(true))} className="font-mono text-xs" />
          </Field>
          {unknown.length ? <Notice tone="warning">{t("admin.emailTemplates.unknownVars", { vars: unknown.join(", ") })}</Notice> : null}
          <FormError error={error} />
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={save} disabled={busy || !dirty || !subject.trim() || !body.trim()}>
                <Save />
                {t("admin.cms.saveDraft")}
              </Button>
              <ActionDialog
                trigger={
                  <Button size="sm" disabled={busy || !subject.trim() || !body.trim()}>
                    <Rocket />
                    {t("admin.emailTemplates.publish")}
                  </Button>
                }
                title={t("admin.emailTemplates.publishTitle")}
                description={t("admin.emailTemplates.publishHint")}
                confirmLabel={t("admin.emailTemplates.publish")}
                onConfirm={async (reason) => {
                  if (dirty && !(await save())) return;
                  await api(`${path}/publish`, { method: "POST", body: { reason } });
                  router.refresh();
                }}
              />
              {published ? (
                <ActionDialog
                  trigger={
                    <Button size="sm" variant="ghost">
                      <Undo2 />
                      {t("admin.emailTemplates.unpublish")}
                    </Button>
                  }
                  title={t("admin.emailTemplates.unpublishTitle")}
                  confirmLabel={t("admin.emailTemplates.unpublish")}
                  onConfirm={async (reason) => {
                    await api(`${path}/unpublish`, { method: "POST", body: { reason } });
                    router.refresh();
                  }}
                />
              ) : null}
            </div>
          ) : null}
        </fieldset>
      </Card>
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader icon={<Eye />} title={t("admin.emailTemplates.preview")} description={t("admin.emailTemplates.previewHint")} />
          <div dir={locale.startsWith("ar") ? "rtl" : "ltr"} lang={locale} className="grid gap-3 p-4">
            <div className="rounded-md border bg-surface-2 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{t("admin.emailTemplates.subject")}: </span>
              <span className="font-medium">{preview.subject || "—"}</span>
            </div>
            <div className="grid gap-3 rounded-md border bg-white p-4 text-sm leading-relaxed text-[#0b1220]">
              {preview.paragraphs.map((p, i) =>
                /^https?:\/\/\S+$/.test(p.trim()) ? (
                  <span key={i} className="inline-flex w-fit rounded-md bg-[#1764ff] px-4 py-2 text-xs font-semibold text-white">
                    {p.trim()}
                  </span>
                ) : (
                  <p key={i} className="whitespace-pre-line">
                    {p}
                  </p>
                ),
              )}
            </div>
          </div>
        </Card>
        {canManage ? (
          <Card>
            <CardHeader icon={<Send />} title={t("admin.emailTemplates.testSend")} description={configured ? t("admin.emailTemplates.testHint") : t("admin.emailTemplates.notConfigured")} />
            <form
              className="flex flex-wrap items-end gap-2 p-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError(null);
                setSent(false);
                try {
                  if (dirty && !(await save())) return;
                  await api(`${path}/test`, { method: "POST", body: { to } });
                  setSent(true);
                } catch (err) {
                  setError(err);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label={t("admin.emailTemplates.to")} htmlFor="et-to" className="min-w-56 flex-1">
                <Input id="et-to" type="email" required value={to} onChange={(e) => setTo(e.target.value)} disabled={!configured} />
              </Field>
              <Button type="submit" variant="secondary" disabled={!configured || busy || !to}>
                <Send />
                {t("admin.emailTemplates.send")}
              </Button>
              {sent ? <p className="w-full text-xs text-success">{t("admin.emailTemplates.sent", { to })}</p> : null}
            </form>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
