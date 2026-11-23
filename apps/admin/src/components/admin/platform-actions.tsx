"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Megaphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { ActionDialog, useAdminAction } from "./action-dialog";

// ───────────── Marketplace ─────────────

export function ListingReview({ listingId, name }: { listingId: string; name: string }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const path = `/api/v1/admin/marketplace/listings/${listingId}/review`;
  return (
    <span className="inline-flex gap-1">
      <ActionDialog
        trigger={
          <Button size="sm">
            <Check />
            {t("admin.marketplace.approve")}
          </Button>
        }
        title={t("admin.marketplace.approveTitle", { name })}
        confirmLabel={t("admin.marketplace.approve")}
        onConfirm={(reason) => run(path, "POST", { decision: "approve", note: reason })}
      />
      <ActionDialog
        trigger={
          <Button size="sm" variant="secondary">
            <X />
            {t("admin.marketplace.reject")}
          </Button>
        }
        title={t("admin.marketplace.rejectTitle", { name })}
        description={t("admin.marketplace.rejectHint")}
        confirmLabel={t("admin.marketplace.reject")}
        danger
        onConfirm={(reason) => run(path, "POST", { decision: "reject", note: reason })}
      />
    </span>
  );
}

export function ListingModerate({ listingId, name, listed }: { listingId: string; name: string; listed: boolean }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const label = listed ? t("admin.marketplace.unlist") : t("admin.marketplace.relist");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="ghost">
          {label}
        </Button>
      }
      title={`${label}: ${name}`}
      description={listed ? t("admin.marketplace.unlistHint") : undefined}
      confirmLabel={label}
      danger={listed}
      onConfirm={(reason) => run(`/api/v1/admin/marketplace/listings/${listingId}/moderate`, "POST", { action: listed ? "unlist" : "relist", reason })}
    />
  );
}

export function PublisherVerify({ publisherId, name, verified }: { publisherId: string; name: string; verified: boolean }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const label = verified ? t("admin.marketplace.unverify") : t("admin.marketplace.verify");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant={verified ? "ghost" : "secondary"}>
          {label}
        </Button>
      }
      title={`${label}: ${name}`}
      confirmLabel={label}
      onConfirm={(reason) => run(`/api/v1/admin/marketplace/publishers/${publisherId}`, "PUT", { verified: !verified, reason })}
    />
  );
}

// ───────────── Webhooks ─────────────

export function WebhookToggle({ id, name, active }: { id: string; name: string; active: boolean }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const label = active ? t("admin.developers.disable") : t("admin.developers.enable");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant={active ? "ghost" : "secondary"}>
          {label}
        </Button>
      }
      title={`${label}: ${name}`}
      description={active ? t("admin.developers.disableHint") : undefined}
      confirmLabel={label}
      danger={active}
      onConfirm={(reason) => run(`/api/v1/admin/webhooks/${id}`, "PUT", { active: !active, reason })}
    />
  );
}

// ───────────── Announcements & banner ─────────────

export function AnnouncementComposer({ activeOrganizations }: { activeOrganizations: number }) {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [href, setHref] = useState("/");
  const [mode, setMode] = useState<"all" | "selected">("all");
  const [orgIds, setOrgIds] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ orgCount: number; recipients: number } | null>(null);
  const ids = orgIds.split(/[\s,]+/).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  return (
    <Card>
      <CardHeader icon={<Megaphone />} title={t("admin.announcements.compose")} description={t("admin.announcements.composeHint")} />
      <form
        className="grid gap-3 p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!window.confirm(mode === "all" ? t("admin.announcements.confirmAll", { count: activeOrganizations }) : t("admin.announcements.confirmSelected", { count: ids.length }))) return;
          setBusy(true);
          setError(null);
          try {
            const r = await api<{ orgCount: number; recipients: number }>("/api/v1/admin/announcements", { method: "POST", body: { title, body, href, audience: mode === "all" ? "all" : ids, reason } });
            setResult(r);
            setTitle("");
            setBody("");
            setReason("");
            router.refresh();
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={t("admin.announcements.title")} htmlFor="an-title">
          <Input id="an-title" required minLength={3} maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t("admin.announcements.body")} htmlFor="an-body" hint={t("admin.announcements.bodyHint")}>
          <Textarea id="an-body" maxLength={1000} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <Field label={t("admin.announcements.link")} htmlFor="an-href" hint={t("admin.announcements.linkHint")}>
          <Input id="an-href" value={href} onChange={(e) => setHref(e.target.value)} className="font-mono" />
        </Field>
        <fieldset className="grid gap-2">
          <legend className="text-[13px] font-medium">{t("admin.announcements.audience")}</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="aud" checked={mode === "all"} onChange={() => setMode("all")} />
            {t("admin.announcements.all", { count: activeOrganizations })}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="aud" checked={mode === "selected"} onChange={() => setMode("selected")} />
            {t("admin.announcements.selected")}
          </label>
          {mode === "selected" ? <Textarea aria-label={t("admin.announcements.orgIds")} placeholder={t("admin.announcements.orgIds")} rows={3} value={orgIds} onChange={(e) => setOrgIds(e.target.value)} className="font-mono text-xs" /> : null}
        </fieldset>
        <Field label={t("common.reason")} htmlFor="an-reason" hint={t("admin.common.reasonAudited")}>
          <Input id="an-reason" required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <FormError error={error} />
        {result ? <p className="text-xs text-success">{t("admin.announcements.sent", { recipients: result.recipients, orgs: result.orgCount })}</p> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || title.trim().length < 3 || reason.trim().length < 3 || (mode === "selected" && !ids.length)}>
            <Megaphone />
            {t("admin.announcements.send")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export interface BannerDTO {
  active: boolean;
  tone: "info" | "warning" | "danger";
  message: string;
  href: string;
  endsAt: string | null;
}

export function BannerEditor({ banner }: { banner: BannerDTO }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [b, setB] = useState(banner);
  const [ends, setEnds] = useState(banner.endsAt ? banner.endsAt.slice(0, 16) : "");
  const submit = (active: boolean) => (reason: string) => run("/api/v1/admin/banner", "PUT", { ...b, active, endsAt: ends ? new Date(ends).toISOString() : null, reason });
  return (
    <div className="grid gap-3 p-3">
      <Field label={t("admin.announcements.bannerMessage")} htmlFor="bn-msg">
        <Textarea id="bn-msg" rows={2} maxLength={300} value={b.message} onChange={(e) => setB({ ...b, message: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("admin.announcements.tone")} htmlFor="bn-tone">
          <Select id="bn-tone" value={b.tone} onChange={(e) => setB({ ...b, tone: e.target.value as BannerDTO["tone"] })}>
            {(["info", "warning", "danger"] as const).map((x) => (
              <option key={x} value={x}>
                {t(`admin.announcements.tones.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("admin.announcements.link")} htmlFor="bn-href">
          <Input id="bn-href" value={b.href} onChange={(e) => setB({ ...b, href: e.target.value })} className="font-mono" />
        </Field>
        <Field label={t("admin.announcements.endsAt")} htmlFor="bn-ends">
          <Input id="bn-ends" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {banner.active ? <ActionDialog trigger={<Button size="sm" variant="ghost">{t("admin.announcements.clearBanner")}</Button>} title={t("admin.announcements.clearBanner")} confirmLabel={t("admin.announcements.clearBanner")} onConfirm={submit(false)} /> : null}
        <ActionDialog
          trigger={
            <Button size="sm" disabled={!b.message.trim()}>
              {banner.active ? t("admin.announcements.updateBanner") : t("admin.announcements.showBanner")}
            </Button>
          }
          title={t("admin.announcements.showBanner")}
          description={t("admin.announcements.bannerHint")}
          confirmLabel={t("admin.announcements.showBanner")}
          onConfirm={submit(true)}
        />
      </div>
    </div>
  );
}
