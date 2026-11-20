"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { ActionDialog, useAdminAction } from "./action-dialog";

/** Create a page, blog post or landing page (slug + English title), then open the editor. */
export function NewEntryButton({ defaultKind = "PAGE" }: { defaultKind?: "PAGE" | "POST" | "LANDING" }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(defaultKind);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const auto = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus />
          {t("admin.cms.new")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("admin.cms.new")} description={t("admin.cms.newHint")} closeLabel={t("common.close")}>
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const r = await api<{ id: string }>("/api/v1/admin/cms/entries", { method: "POST", body: { kind, title, slug } });
              router.push(`/${locale}/cms/${r.id}`);
            } catch (err) {
              setError(err);
              setBusy(false);
            }
          }}
        >
          <Field label={t("admin.cms.kind")} htmlFor="new-kind">
            <Select id="new-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {(["PAGE", "POST", "LANDING"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`admin.cms.kinds.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("admin.cms.fields.pageTitle")} htmlFor="new-title">
            <Input id="new-title" required maxLength={200} value={title} onChange={(e) => (setTitle(e.target.value), !touched && setSlug(auto(e.target.value)))} />
          </Field>
          <Field label={t("admin.cms.fields.slug")} htmlFor="new-slug" hint={`/pages/${slug || "…"}`}>
            <Input id="new-slug" required className="font-mono" value={slug} onChange={(e) => (setTouched(true), setSlug(auto(e.target.value)))} />
          </Field>
          <FormError error={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !title.trim() || !slug}>
              {t("admin.cms.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Upload an image to the media library (base64 JSON through the admin API → integrations storage). */
export function MediaUpload({ disabled }: { disabled?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="grid gap-2">
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml"
        className="sr-only"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setError(null);
          if (file.size > 5 * 1024 * 1024) return setError(new Error(t("admin.cms.media.tooLarge")));
          setBusy(true);
          try {
            const data = await new Promise<string>((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
              r.onerror = () => reject(r.error);
              r.readAsDataURL(file);
            });
            await api("/api/v1/admin/cms/media", { method: "POST", body: { fileName: file.name, contentType: file.type, data, alt: file.name.replace(/\.[^.]+$/, "") } });
            router.refresh();
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button size="sm" onClick={() => ref.current?.click()} disabled={disabled || busy} aria-busy={busy}>
        <Upload />
        {busy ? t("admin.cms.media.uploading") : t("admin.cms.media.upload")}
      </Button>
      <FormError error={error} />
    </div>
  );
}

export function MediaDelete({ id, name }: { id: string; name: string }) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <ActionDialog
      trigger={
        <Button size="icon" variant="ghost" className="size-7 text-danger" aria-label={t("admin.cms.media.delete", { name })}>
          <Trash2 className="size-3.5" />
        </Button>
      }
      title={t("admin.cms.media.delete", { name })}
      description={t("admin.cms.media.deleteHint")}
      confirmLabel={t("admin.cms.media.deleteConfirm")}
      danger
      onConfirm={async () => {
        await api(`/api/v1/admin/cms/media/${id}`, { method: "DELETE" });
        router.refresh();
      }}
    />
  );
}

/** Choose the company whose storage (S3 connection or database fallback) holds website media. */
export function MediaTargetPicker({ current }: { current: string | null }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<{ id: string; name: string; organization: { name: string } }[]>([]);
  const [companyId, setCompanyId] = useState("");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant={current ? "secondary" : "default"}>
          {current ? t("admin.cms.media.changeTarget") : t("admin.cms.media.chooseTarget")}
        </Button>
      }
      title={t("admin.cms.media.chooseTarget")}
      description={t("admin.cms.media.targetHint")}
      confirmLabel={t("common.save")}
      canSubmit={!!companyId}
      onConfirm={(reason) => run("/api/v1/admin/cms/media-target", "PUT", { companyId, reason })}
    >
      <Field label={t("admin.cms.media.searchCompany")} htmlFor="mt-q">
        <div className="flex gap-2">
          <Input id="mt-q" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button type="button" variant="secondary" onClick={async () => setOptions((await api<{ data: typeof options }>(`/api/v1/admin/cms/media-target?q=${encodeURIComponent(q)}`)).data)}>
            {t("admin.users.searchButton")}
          </Button>
        </div>
      </Field>
      {options.length ? (
        <Field label={t("admin.cms.media.company")} htmlFor="mt-company">
          <Select id="mt-company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">—</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.organization.name} · {o.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
    </ActionDialog>
  );
}
