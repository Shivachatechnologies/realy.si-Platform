"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, GlobeLock, Plus, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      router.refresh();
      return r;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, run, router };
}

/** Take the whole site online / offline. */
export function OnlineToggle({ base, online, canManage, hasPublished }: { base: string; online: boolean; canManage: boolean; hasPublished: boolean }) {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-2">
      {online ? (
        <Button variant="secondary" disabled={!canManage} loading={!!busy} onClick={() => window.confirm(t("sites.overview.offlineConfirm")) && run("off", () => api(`${base}/sites/actions`, { body: { action: "go_offline" } }))}>
          <GlobeLock aria-hidden />
          {t("sites.overview.goOffline")}
        </Button>
      ) : (
        <Button variant="luminous" disabled={!canManage || !hasPublished} loading={!!busy} onClick={() => run("on", () => api(`${base}/sites/actions`, { body: { action: "go_online" } }))}>
          <Globe aria-hidden />
          {t("sites.overview.goOnline")}
        </Button>
      )}
      {!online && !hasPublished ? <p className="text-xs text-muted-foreground">{t("sites.overview.publishFirst")}</p> : null}
      <FormError error={error} />
    </div>
  );
}

/** "Generate my website" — the web designer AI drafts pages (approval required, nothing is published). */
export function GenerateWebsite({ base, disabledReason, compact }: { base: string; disabledReason: string | null; compact?: boolean }) {
  const { t, locale } = useI18n();
  const { busy, error, run, router } = useAction();
  const [brief, setBrief] = useState("");
  const [focus, setFocus] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant={compact ? "secondary" : "gradient"} size={compact ? "sm" : "default"} disabled={!!disabledReason} title={disabledReason ?? undefined}>
          <Wand2 aria-hidden />
          {t("sites.ai.generate")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("sites.ai.title")} description={t("sites.ai.description")} closeLabel={t("common.close")}>
        {taskId ? (
          <div className="grid gap-3">
            <Notice tone="success" title={t("sites.ai.startedTitle")}>
              {t("sites.ai.started")}
            </Notice>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => router.push(`/${locale}/tasks/${taskId}`)}>
                {t("sites.ai.openTask")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => router.push(`/${locale}/approvals`)}>
                {t("sites.ai.openApprovals")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <Field label={t("sites.ai.brief")} htmlFor="ai-brief" hint={t("sites.ai.briefHint")}>
              <Textarea id="ai-brief" rows={4} maxLength={2000} value={brief} onChange={(e) => setBrief(e.target.value)} />
            </Field>
            <Field label={t("sites.ai.focus")} htmlFor="ai-focus" hint={t("sites.ai.focusHint")}>
              <Input id="ai-focus" maxLength={300} value={focus} onChange={(e) => setFocus(e.target.value)} />
            </Field>
            <p className="text-xs text-muted-foreground">{t("sites.ai.approvalNote")}</p>
            <FormError error={error} />
            <Button loading={!!busy} onClick={async () => {
              const r = await run("gen", () => api<{ taskId: string }>(`${base}/sites/generate`, { body: { brief: brief || undefined, focus: focus || undefined } }));
              if (r) setTaskId(r.taskId);
            }}>
              <Wand2 aria-hidden />
              {t("sites.ai.start")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** New page or landing page. */
export function NewPageDialog({ base, pages, canManage }: { base: string; pages: { id: string; title: string }[]; canManage: boolean }) {
  const { t, locale } = useI18n();
  const { busy, error, run, router } = useAction();
  const [kind, setKind] = useState<"PAGE" | "LANDING">("PAGE");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [from, setFrom] = useState<"blank" | "landing" | "duplicate">("blank");
  const [source, setSource] = useState(pages[0]?.id ?? "");
  const auto = (v: string) => v.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button disabled={!canManage}>
          <Plus aria-hidden />
          {t("sites.pages.new")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("sites.pages.newTitle")} closeLabel={t("common.close")}>
        <div className="grid gap-3">
          <div role="radiogroup" aria-label={t("sites.editor.kind")} className="grid grid-cols-2 gap-2">
            {(["PAGE", "LANDING"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => (setKind(k), setFrom(k === "LANDING" ? "landing" : "blank"))} className={`grid gap-0.5 rounded-lg border p-3 text-start text-sm ${kind === k ? "border-primary bg-accent/50" : "hover:border-border-strong"}`}>
                <span className="font-medium">{t(`sites.kinds.${k}`)}</span>
                <span className="text-xs text-muted-foreground">{t(`sites.kindHints.${k}`)}</span>
              </button>
            ))}
          </div>
          <Field label={t("sites.editor.pageTitle")} htmlFor="np-title">
            <Input id="np-title" value={title} maxLength={160} onChange={(e) => (setTitle(e.target.value), !slug || slug === auto(title) ? setSlug(auto(e.target.value)) : null)} />
          </Field>
          <Field label={t("sites.editor.path")} htmlFor="np-slug" hint={t("sites.pages.pathHint")}>
            <Input id="np-slug" value={slug} maxLength={180} className="font-mono" onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9/-]/g, "-"))} />
          </Field>
          <Field label={t("sites.pages.startFrom")} htmlFor="np-from">
            <Select id="np-from" value={from} onChange={(e) => setFrom(e.target.value as typeof from)}>
              <option value="blank">{t("sites.pages.from.blank")}</option>
              <option value="landing">{t("sites.pages.from.landing")}</option>
              {pages.length ? <option value="duplicate">{t("sites.pages.from.duplicate")}</option> : null}
            </Select>
          </Field>
          {from === "duplicate" ? (
            <Select aria-label={t("sites.pages.from.duplicate")} value={source} onChange={(e) => setSource(e.target.value)}>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
          ) : null}
          <FormError error={error} />
          <Button
            loading={!!busy}
            disabled={!title.trim()}
            onClick={async () => {
              const r = await run("create", () => api<{ id: string }>(`${base}/sites/pages`, { body: { kind, title, slug, from, ...(from === "duplicate" ? { sourcePageId: source } : {}) } }));
              if (r) router.push(`/${locale}/website/pages/${r.id}`);
            }}
          >
            {t("sites.pages.create")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DeletePageButton({ base, pageId, title, canManage }: { base: string; pageId: string; title: string; canManage: boolean }) {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  return (
    <>
      <Button size="icon" variant="ghost" aria-label={t("sites.pages.delete", { title })} disabled={!canManage} loading={!!busy} onClick={() => window.confirm(t("sites.pages.deleteConfirm", { title })) && run("del", () => api(`${base}/sites/pages/${pageId}`, { method: "DELETE" }))}>
        <Trash2 aria-hidden />
      </Button>
      {error ? <FormError error={error} /> : null}
    </>
  );
}

/** Restore a version into the draft (optionally publishing it). */
export function RollbackButtons({ base, pageId, version, canManage }: { base: string; pageId: string; version: number; canManage: boolean }) {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  const go = (publish: boolean) => window.confirm(t(publish ? "sites.versions.publishConfirm" : "sites.versions.restoreConfirm", { version })) && run(publish ? "pub" : "res", () => api(`${base}/sites/pages/${pageId}/actions`, { body: { action: "rollback", version, publish } }));
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button size="sm" variant="ghost" disabled={!canManage} loading={busy === "res"} onClick={() => go(false)}>
        {t("sites.versions.restore")}
      </Button>
      <Button size="sm" variant="secondary" disabled={!canManage} loading={busy === "pub"} onClick={() => go(true)}>
        {t("sites.versions.restorePublish")}
      </Button>
      <FormError error={error} />
    </div>
  );
}

/** Inbox: mark read / archive / new. */
export function SubmissionStatus({ base, id, status, canManage }: { base: string; id: string; status: "NEW" | "READ" | "ARCHIVED"; canManage: boolean }) {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  const set = (s: "NEW" | "READ" | "ARCHIVED") => run(s, () => api(`${base}/sites/submissions/${id}`, { method: "PATCH", body: { status: s } }));
  return (
    <div className="flex flex-wrap gap-1">
      {status !== "READ" ? (
        <Button size="sm" variant="ghost" disabled={!canManage} loading={busy === "READ"} onClick={() => set("READ")}>
          {t("sites.inbox.markRead")}
        </Button>
      ) : (
        <Button size="sm" variant="ghost" disabled={!canManage} loading={busy === "NEW"} onClick={() => set("NEW")}>
          {t("sites.inbox.markNew")}
        </Button>
      )}
      {status !== "ARCHIVED" ? (
        <Button size="sm" variant="ghost" disabled={!canManage} loading={busy === "ARCHIVED"} onClick={() => set("ARCHIVED")}>
          {t("sites.inbox.archive")}
        </Button>
      ) : null}
      <FormError error={error} />
    </div>
  );
}
