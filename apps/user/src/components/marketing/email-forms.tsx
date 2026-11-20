"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Plus, RefreshCw, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { localInputToIso } from "./format";
import { useAction } from "./ui";

type Option = { id: string; name: string };
const TAGS = ["firstName", "lastName", "email", "company", "sender"];

function MergeTagHint() {
  const t = useT();
  return <span>{t("marketing.email.mergeTags", { tags: TAGS.map((x) => `{{${x}}}`).join(" ") })}</span>;
}

export function TemplateForm({ base, initial }: { base: string; initial?: { id: string; name: string; subject: string; body: string } }) {
  const t = useT();
  const empty = { name: "", subject: "", body: "" };
  const [f, setF] = useState(initial ?? empty);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const id = initial?.id ?? "new";
  return (
    <form
      className="grid gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const body = { name: f.name, subject: f.subject, body: f.body };
        void run(() => (initial ? api(`${base}/email/templates/${initial.id}`, { method: "PATCH", body }) : api(`${base}/email/templates`, { body })), () => !initial && setF(empty));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("marketing.email.templateName")} htmlFor={`tpl-name-${id}`}>
          <Input id={`tpl-name-${id}`} value={f.name} maxLength={120} required onChange={set("name")} />
        </Field>
        <Field label={t("marketing.email.subject")} htmlFor={`tpl-subject-${id}`}>
          <Input id={`tpl-subject-${id}`} value={f.subject} maxLength={250} required onChange={set("subject")} />
        </Field>
      </div>
      <Field label={t("marketing.email.body")} htmlFor={`tpl-body-${id}`} hint={<MergeTagHint />}>
        <Textarea id={`tpl-body-${id}`} rows={8} value={f.body} maxLength={50_000} required onChange={set("body")} />
      </Field>
      <div>
        <Button type="submit" size="sm" disabled={busy || !f.name.trim() || !f.subject.trim() || !f.body.trim()}>
          {initial ? <Save aria-hidden /> : <Plus aria-hidden />}
          {initial ? t("common.save") : t("marketing.email.createTemplate")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

export function NewEmailCampaignForm({ base, locale, templates, segments, campaigns }: { base: string; locale: string; templates: Option[]; segments: Option[]; campaigns: Option[] }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState({ name: "", templateId: "", segmentId: "", campaignId: "" });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form
      className="grid gap-3 p-4 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api<{ id: string }>(`${base}/email/campaigns`, { body: f }), (r) => router.push(`/${locale}/marketing/email/${r.id}`));
      }}
    >
      <Field label={t("marketing.email.campaignName")} htmlFor="ec-name">
        <Input id="ec-name" value={f.name} maxLength={200} required onChange={set("name")} />
      </Field>
      <Field label={t("marketing.email.template")} htmlFor="ec-tpl">
        <Select id="ec-tpl" value={f.templateId} onChange={set("templateId")}>
          <option value="">{t("marketing.email.blank")}</option>
          {templates.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("marketing.email.segment")} htmlFor="ec-seg">
        <Select id="ec-seg" value={f.segmentId} onChange={set("segmentId")}>
          <option value="">{t("common.none")}</option>
          {segments.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("marketing.campaigns.campaign")} htmlFor="ec-cmp">
        <Select id="ec-cmp" value={f.campaignId} onChange={set("campaignId")}>
          <option value="">{t("common.none")}</option>
          {campaigns.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-4">
        <Button type="submit" size="sm" disabled={busy || !f.name.trim()}>
          <Plus aria-hidden />
          {t("marketing.email.createCampaign")}
        </Button>
      </div>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function EmailCampaignEditor({ base, initial, segments, campaigns }: { base: string; initial: { id: string; name: string; subject: string; body: string; segmentId: string; campaignId: string }; segments: Option[]; campaigns: Option[] }) {
  const t = useT();
  const [f, setF] = useState(initial);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form
      className="grid gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/email/campaigns/${initial.id}`, { method: "PATCH", body: { name: f.name, subject: f.subject, body: f.body, segmentId: f.segmentId || null, campaignId: f.campaignId || null } }));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("marketing.email.campaignName")} htmlFor="ece-name">
          <Input id="ece-name" value={f.name} maxLength={200} required onChange={set("name")} />
        </Field>
        <Field label={t("marketing.email.segment")} htmlFor="ece-seg">
          <Select id="ece-seg" value={f.segmentId} onChange={set("segmentId")}>
            <option value="">{t("common.none")}</option>
            {segments.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("marketing.campaigns.campaign")} htmlFor="ece-cmp">
          <Select id="ece-cmp" value={f.campaignId} onChange={set("campaignId")}>
            <option value="">{t("common.none")}</option>
            {campaigns.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("marketing.email.subject")} htmlFor="ece-subject">
        <Input id="ece-subject" value={f.subject} maxLength={250} onChange={set("subject")} />
      </Field>
      <Field label={t("marketing.email.body")} htmlFor="ece-body" hint={<MergeTagHint />}>
        <Textarea id="ece-body" rows={12} value={f.body} maxLength={50_000} onChange={set("body")} />
      </Field>
      <p className="text-xs text-muted-foreground">{t("marketing.email.complianceNote")}</p>
      <div>
        <Button type="submit" size="sm" disabled={busy || !f.name.trim()}>
          <Save aria-hidden />
          {t("common.save")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

export function EmailActions({ base, id, status, audience, emailReady }: { base: string; id: string; status: string; audience: number; emailReady: boolean }) {
  const t = useT();
  const [when, setWhen] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const act = (body: Record<string, unknown>) =>
    run(
      () => api<{ status: string }>(`${base}/email/campaigns/${id}/actions`, { body }),
      (r) => body.action === "test" && setResult(r.status),
    );
  const sendable = status === "DRAFT" || status === "SCHEDULED";
  return (
    <div className="grid gap-3 p-4">
      {!emailReady ? <Notice tone="warning">{t("marketing.email.notConfigured")}</Notice> : null}
      <p className="text-sm">{t("marketing.email.audienceCount", { count: audience })}</p>
      <div className="flex flex-wrap items-end gap-2">
        {sendable ? (
          <>
            <Button type="button" size="sm" className="h-9" disabled={busy || !emailReady || !audience} onClick={() => window.confirm(t("marketing.email.confirmSend", { count: audience })) && void act({ action: "send_now" })}>
              <Send aria-hidden />
              {t("marketing.email.sendNow")}
            </Button>
            <Field label={t("marketing.email.scheduleFor")} htmlFor="ea-when">
              <Input id="ea-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </Field>
            <Button type="button" size="sm" className="h-9" variant="secondary" disabled={busy || !when} onClick={() => void act({ action: "schedule", scheduledAt: localInputToIso(when) })}>
              {t("marketing.email.schedule")}
            </Button>
            <Button type="button" size="sm" className="h-9" variant="ghost" disabled={busy || !emailReady} onClick={() => void act({ action: "test" })}>
              <FlaskConical aria-hidden />
              {t("marketing.email.sendTest")}
            </Button>
          </>
        ) : null}
        {status === "SCHEDULED" || status === "SENDING" ? (
          <Button type="button" size="sm" className="h-9" variant="secondary" disabled={busy} onClick={() => window.confirm(t("marketing.email.confirmCancel")) && void act({ action: "cancel" })}>
            {status === "SCHEDULED" ? t("marketing.email.unschedule") : t("marketing.email.stopSending")}
          </Button>
        ) : null}
        {status === "FAILED" || status === "CANCELLED" ? (
          <Button type="button" size="sm" className="h-9" disabled={busy || !emailReady} onClick={() => void act({ action: "retry" })}>
            <RefreshCw aria-hidden />
            {t("marketing.email.retry")}
          </Button>
        ) : null}
      </div>
      {result ? <Notice tone={result === "SENT" ? "success" : "warning"}>{t(`marketing.email.testResult.${result}`)}</Notice> : null}
      <FormError error={error} />
    </div>
  );
}
