"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Plus, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { localInputToIso, splitList } from "./format";
import { useAction } from "./ui";

export const CONTENT_TYPES = ["BLOG", "SEO_ARTICLE", "LINKEDIN", "X", "INSTAGRAM", "FACEBOOK", "THREADS", "TIKTOK_SCRIPT", "YOUTUBE_SCRIPT", "VIDEO_SCRIPT", "CAROUSEL", "QUOTE", "GRAPHIC_BRIEF", "NEWSLETTER", "EMAIL", "AD", "LANDING_PAGE", "WEBSITE_COPY", "CASE_STUDY", "PRESS_RELEASE", "PRODUCT_ANNOUNCEMENT", "THOUGHT_LEADERSHIP", "INDUSTRY_REPORT"] as const;
const LIMITS: Partial<Record<string, number>> = { X: 280, LINKEDIN: 3000, INSTAGRAM: 2200, FACEBOOK: 63206, THREADS: 500 };

type Option = { id: string; name: string };

export function NewContentForm({ base, locale, campaigns, defaultCampaignId }: { base: string; locale: string; campaigns: Option[]; defaultCampaignId?: string }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState({ type: "BLOG", title: "", brief: "", campaignId: defaultCampaignId ?? "" });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form
      className="grid gap-3 p-4 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () => api<{ id: string }>(`${base}/content`, { body: f }),
          (r) => router.push(`/${locale}/marketing/content/${r.id}`),
        );
      }}
    >
      <Field label={t("marketing.content.type")} htmlFor="ct-type">
        <Select id="ct-type" value={f.type} onChange={set("type")}>
          {CONTENT_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`marketing.contentType.${x}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("marketing.content.titleLabel")} htmlFor="ct-title" className="sm:col-span-2">
        <Input id="ct-title" value={f.title} maxLength={250} required onChange={set("title")} />
      </Field>
      <Field label={t("marketing.campaigns.campaign")} htmlFor="ct-campaign">
        <Select id="ct-campaign" value={f.campaignId} onChange={set("campaignId")}>
          <option value="">{t("common.none")}</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("marketing.content.brief")} htmlFor="ct-brief" hint={t("marketing.content.briefHint")} className="sm:col-span-4">
        <Textarea id="ct-brief" rows={3} value={f.brief} maxLength={5000} onChange={set("brief")} />
      </Field>
      <div className="sm:col-span-4">
        <Button type="submit" disabled={busy || !f.title.trim()}>
          <Plus aria-hidden />
          {t("marketing.content.create")}
        </Button>
      </div>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function ContentEditor({
  base,
  content,
  campaigns,
  readOnly,
}: {
  base: string;
  content: { id: string; type: string; title: string; body: string; brief: string; campaignId: string; status: string };
  campaigns: Option[];
  readOnly: boolean;
}) {
  const t = useT();
  const [f, setF] = useState(content);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const limit = LIMITS[f.type];
  const reopen = (content.status === "APPROVED" || content.status === "SCHEDULED") && (f.title !== content.title || f.body !== content.body);
  return (
    <form
      className="grid gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/content/${content.id}`, { method: "PATCH", body: { type: f.type, title: f.title, body: f.body, brief: f.brief, campaignId: f.campaignId || null } }));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={t("marketing.content.titleLabel")} htmlFor="ce-title" className="sm:col-span-2">
          <Input id="ce-title" value={f.title} maxLength={250} required disabled={readOnly} onChange={set("title")} />
        </Field>
        <Field label={t("marketing.content.type")} htmlFor="ce-type">
          <Select id="ce-type" value={f.type} disabled={readOnly} onChange={set("type")}>
            {CONTENT_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`marketing.contentType.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("marketing.campaigns.campaign")} htmlFor="ce-campaign">
          <Select id="ce-campaign" value={f.campaignId} disabled={readOnly} onChange={set("campaignId")}>
            <option value="">{t("common.none")}</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field
        label={t("marketing.content.body")}
        htmlFor="ce-body"
        hint={limit ? t("marketing.content.charCount", { count: f.body.length, limit }) : t("marketing.content.charCountPlain", { count: f.body.length })}
        error={limit && f.body.length > limit ? t("marketing.content.overLimit", { limit }) : undefined}
      >
        <Textarea id="ce-body" rows={14} value={f.body} maxLength={100_000} disabled={readOnly} onChange={set("body")} className="font-mono text-[13px]" />
      </Field>
      <Field label={t("marketing.content.brief")} htmlFor="ce-brief">
        <Textarea id="ce-brief" rows={3} value={f.brief} maxLength={5000} disabled={readOnly} onChange={set("brief")} />
      </Field>
      {reopen ? <p className="text-xs text-warning">{t("marketing.content.reopenWarning")}</p> : null}
      {!readOnly ? (
        <div>
          <Button type="submit" disabled={busy || !f.title.trim()}>
            <Save aria-hidden />
            {t("marketing.content.saveVersion")}
          </Button>
        </div>
      ) : null}
      <FormError error={error} />
    </form>
  );
}

/** Editorial workflow buttons for the current status. */
export function WorkflowActions({ base, contentId, status, scheduledAt }: { base: string; contentId: string; status: string; scheduledAt: string }) {
  const t = useT();
  const [comment, setComment] = useState("");
  const [when, setWhen] = useState(scheduledAt);
  const [url, setUrl] = useState("");
  const { busy, error, run } = useAction();
  const act = (body: Record<string, unknown>) => run(() => api(`${base}/content/${contentId}/workflow`, { body }), () => setComment(""));
  return (
    <div className="grid gap-3 p-4">
      {status === "DRAFT" || status === "IN_REVIEW" ? (
        <Field label={t("marketing.content.reviewComment")} htmlFor="wf-comment">
          <Textarea id="wf-comment" rows={2} value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} />
        </Field>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {status === "DRAFT" ? (
          <Button type="button" size="sm" disabled={busy} onClick={() => void act({ action: "submit", comment: comment || undefined })}>
            <Send aria-hidden />
            {t("marketing.content.submitReview")}
          </Button>
        ) : null}
        {status === "IN_REVIEW" ? (
          <>
            <Button type="button" size="sm" disabled={busy} onClick={() => void act({ action: "approve", comment: comment || undefined })}>
              {t("marketing.content.approve")}
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={busy || !comment.trim()} onClick={() => void act({ action: "request_changes", comment })}>
              {t("marketing.content.requestChanges")}
            </Button>
          </>
        ) : null}
        {status === "SCHEDULED" ? (
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void act({ action: "unschedule" })}>
            {t("marketing.content.unschedule")}
          </Button>
        ) : null}
      </div>
      {status === "APPROVED" || status === "SCHEDULED" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex items-end gap-2">
            <Field label={t("marketing.content.scheduleFor")} htmlFor="wf-when" className="flex-1">
              <Input id="wf-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </Field>
            <Button type="button" size="sm" className="h-9" variant="secondary" disabled={busy || !when} onClick={() => void act({ action: "schedule", scheduledAt: localInputToIso(when) })}>
              {t("marketing.content.schedule")}
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <Field label={t("marketing.content.publishedUrl")} htmlFor="wf-url" className="flex-1">
              <Input id="wf-url" type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
            </Field>
            <Button type="button" size="sm" className="h-9" disabled={busy} onClick={() => void act({ action: "publish", publishedUrl: url })}>
              {t("marketing.content.markPublished")}
            </Button>
          </div>
        </div>
      ) : null}
      <FormError error={error} />
    </div>
  );
}

export function CommentForm({ base, contentId }: { base: string; contentId: string }) {
  const t = useT();
  const [body, setBody] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2 border-t p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/content/${contentId}/comments`, { body: { body } }), () => setBody(""));
      }}
    >
      <Textarea rows={2} value={body} maxLength={4000} aria-label={t("marketing.content.addComment")} placeholder={t("marketing.content.addComment")} onChange={(e) => setBody(e.target.value)} />
      <div>
        <Button type="submit" size="sm" variant="secondary" disabled={busy || !body.trim()}>
          <MessageSquare aria-hidden />
          {t("marketing.content.comment")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

export function MetaEditor({ base, content, readOnly }: { base: string; content: { id: string; slug: string; metaTitle: string; metaDescription: string; keywords: string[] }; readOnly: boolean }) {
  const t = useT();
  const [f, setF] = useState({ slug: content.slug, metaTitle: content.metaTitle, metaDescription: content.metaDescription, keywords: content.keywords.join(", ") });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const tl = f.metaTitle.length;
  const dl = f.metaDescription.length;
  return (
    <form
      className="grid gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/content/${content.id}`, { method: "PATCH", body: { slug: f.slug, metaTitle: f.metaTitle, metaDescription: f.metaDescription, keywords: splitList(f.keywords) } }));
      }}
    >
      <Field label={t("marketing.seo.metaTitle")} htmlFor="meta-title" hint={t("marketing.seo.metaTitleHint", { count: tl })} error={tl > 60 ? t("marketing.seo.tooLong") : undefined}>
        <Input id="meta-title" value={f.metaTitle} maxLength={120} disabled={readOnly} onChange={set("metaTitle")} />
      </Field>
      <Field label={t("marketing.seo.metaDescription")} htmlFor="meta-desc" hint={t("marketing.seo.metaDescriptionHint", { count: dl })} error={dl > 160 ? t("marketing.seo.tooLong") : undefined}>
        <Textarea id="meta-desc" rows={2} value={f.metaDescription} maxLength={320} disabled={readOnly} onChange={set("metaDescription")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("marketing.seo.slug")} htmlFor="meta-slug">
          <Input id="meta-slug" value={f.slug} maxLength={200} pattern="[a-z0-9\-]*" disabled={readOnly} onChange={set("slug")} />
        </Field>
        <Field label={t("marketing.seo.keywords")} htmlFor="meta-kw" hint={t("marketing.common.commaSeparated")}>
          <Input id="meta-kw" value={f.keywords} disabled={readOnly} onChange={set("keywords")} />
        </Field>
      </div>
      {f.metaTitle || f.metaDescription ? (
        <div className="rounded-md border p-3" aria-label={t("marketing.seo.preview")}>
          <p className="truncate text-sm text-primary">{f.metaTitle || content.slug}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground">{f.metaDescription}</p>
        </div>
      ) : null}
      {!readOnly ? (
        <div>
          <Button type="submit" size="sm" disabled={busy}>
            <Save aria-hidden />
            {t("common.save")}
          </Button>
        </div>
      ) : null}
      <FormError error={error} />
    </form>
  );
}

export function DistributeForm({ base, locale, contentId, accounts }: { base: string; locale: string; contentId: string; accounts: { id: string; name: string; provider: string; connected: boolean }[] }) {
  const t = useT();
  const router = useRouter();
  const [ids, setIds] = useState<string[]>([]);
  const [when, setWhen] = useState("");
  const { busy, error, run } = useAction();
  if (!accounts.length) return <p className="p-4 text-xs text-muted-foreground">{t("marketing.social.noAccounts")}</p>;
  return (
    <form
      className="grid gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () => api<{ id: string }>(`${base}/content/${contentId}/distribute`, { body: { accountIds: ids, scheduledAt: localInputToIso(when) ?? "" } }),
          (r) => router.push(`/${locale}/marketing/social/${r.id}`),
        );
      }}
    >
      <div className="flex flex-wrap gap-2">
        {accounts.map((a) => (
          <label key={a.id} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
            <input type="checkbox" checked={ids.includes(a.id)} onChange={(e) => setIds((p) => (e.target.checked ? [...p, a.id] : p.filter((x) => x !== a.id)))} />
            {a.name} · {t(`marketing.provider.${a.provider}`)}
            {!a.connected ? <span className="text-warning">({t("common.notConnected")})</span> : null}
          </label>
        ))}
      </div>
      <Field label={t("marketing.social.scheduleOptional")} htmlFor="dist-when">
        <Input id="dist-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" size="sm" disabled={busy || !ids.length}>
          <Send aria-hidden />
          {t("marketing.content.distribute")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}
