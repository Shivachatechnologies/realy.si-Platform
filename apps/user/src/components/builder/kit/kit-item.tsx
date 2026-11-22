"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Download, ExternalLink, FileText, ImageIcon, Pencil, PlugZap, RotateCcw, Sparkles, Wand2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { Markdown } from "@/components/guide/markdown";
import { KIT_TONE } from "./kit-tone";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { forecastRows, NameIdeas, RecordLinks, Sources, StructuredView } from "./kit-views";
import { cleanData, StructuredEditor, type Enums } from "./structured-editor";

export type KitItemProps = {
  key: string;
  kind: "ai" | "image";
  deps: string[];
  actions: string[];
  hasSchema: boolean;
  status: "PENDING" | "GENERATING" | "READY" | "FAILED" | "NEEDS_SETUP";
  content: string | null;
  data: Record<string, unknown> | null;
  edited: boolean;
  approved: boolean;
  feedback: string | null;
  brainDocumentId: string | null;
  records: { action: string; kind: string; id: string; label: string; href: string | null }[];
  errorCode: string | null;
  errorMessage: string | null;
  errorIssues: string[];
  taskId: string | null;
  taskStatus: string | null;
};

/** Allowed actions per permission (computed on the server; the services check again). */
export type ActionGates = Record<string, boolean>;

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (v: string | number) => (typeof v === "number" ? String(Math.round(v * 100) / 100) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function websiteMarkdown(data: Record<string, unknown>, company: string) {
  const pages = (data.pages as { slug: string; title: string; purpose: string; sections: { heading: string; content: string }[] }[]) ?? [];
  return [`# ${company} — website structure`, "", "## Sitemap", ...pages.map((p) => `- ${p.slug} — ${p.title}`), "", ...pages.flatMap((p) => [`## ${p.title} (${p.slug})`, "", `_${p.purpose}_`, "", ...p.sections.flatMap((s) => [`### ${s.heading}`, "", s.content, ""])])].join("\n");
}

export function KitItemPanel({
  item,
  base,
  canManage,
  gates,
  enums,
  companyName,
  logoUrls,
  depLabels,
  journey,
}: {
  item: KitItemProps;
  base: string;
  canManage: boolean;
  gates: ActionGates;
  enums: Enums;
  companyName: string;
  logoUrls: { id: string; url: string }[];
  depLabels: { key: string; label: string; ready: boolean }[];
  journey: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(item.content ?? "");
  const [data, setData] = useState<Record<string, unknown>>(item.data ?? {});
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const itemBase = `${base}/kit/${item.key}`;

  async function call(id: string, path: string, body: unknown, method?: string) {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      await api(path, { method, body });
      router.refresh();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const act = async (action: string, value?: string) => {
    const ok = await call(action, `${itemBase}/actions`, { action, ...(value ? { value } : {}) });
    if (ok) setNotice(t(`builder.kit.actions.done.${action}`));
  };

  async function save() {
    const body: Record<string, unknown> = {};
    if (content.trim() && content !== (item.content ?? "")) body.content = content;
    if (item.hasSchema && item.key !== "logo") body.data = cleanData(Object.fromEntries(Object.entries(data).filter(([k]) => !["sources", "research"].includes(k))));
    if (await call("save", itemBase, body, "PATCH")) setEditing(false);
  }

  const ready = item.status === "READY";
  const title = t(`builder.kit.items.${item.key}.title`);

  return (
    <article className="grid gap-4" aria-labelledby={`kit-${item.key}`}>
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={`kit-${item.key}`} className="font-display text-2xl">
            {title}
          </h2>
          <Badge tone={KIT_TONE[item.status]} pulse={item.status === "GENERATING"}>
            {t(`builder.kit.status.${item.status}`)}
          </Badge>
          {item.approved ? (
            <Badge tone="success">
              <Check className="size-3" aria-hidden />
              {t("builder.kit.approved")}
            </Badge>
          ) : null}
          {item.edited ? <Badge tone="neutral">{t("builder.kit.editedByYou")}</Badge> : null}
          {item.key === "financial_forecast" ? <Badge tone="warning">{t("builder.kit.forecast.projection")}</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">{t(`builder.kit.items.${item.key}.description`)}</p>
      </header>

      {/* States before the deliverable exists */}
      {item.status === "PENDING" ? (
        <Notice tone="info" title={t("builder.kit.waiting.title")}>
          {depLabels.some((d) => !d.ready) ? t("builder.kit.waiting.deps", { items: depLabels.filter((d) => !d.ready).map((d) => d.label).join(", ") }) : t("builder.kit.waiting.queued")}
        </Notice>
      ) : null}
      {item.status === "GENERATING" ? (
        <div className="grid gap-3 rounded-xl border border-info/30 bg-info/5 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4 animate-pulse text-info motion-reduce:animate-none" aria-hidden />
            {item.kind === "image" ? t("builder.kit.generating.image") : t("builder.kit.generating.ai")}
          </div>
          <div className="grid gap-2" aria-hidden>
            {[90, 75, 82, 60].map((w, i) => (
              <div key={i} className="h-2.5 animate-pulse rounded-full bg-muted motion-reduce:animate-none" style={{ width: `${w}%` }} />
            ))}
          </div>
          {item.taskId ? (
            <Link className="text-xs text-primary hover:underline" href={`/${locale}/tasks/${item.taskId}`}>
              {t("builder.kit.openTask")}
            </Link>
          ) : null}
        </div>
      ) : null}
      {item.status === "NEEDS_SETUP" ? (
        <Notice
          tone="warning"
          title={t("builder.kit.logo.setupTitle")}
          action={
            <Button asChild size="sm" variant="secondary">
              <Link href={`/${locale}/integrations`}>
                <PlugZap aria-hidden />
                {t("builder.kit.connect")}
              </Link>
            </Button>
          }
        >
          {t("builder.kit.logo.setup")}
        </Notice>
      ) : null}
      {item.status === "FAILED" ? (
        <Notice tone="danger" title={t("builder.kit.failed")}>
          <span className="block">{item.errorCode && t(`errors.reasons.${item.errorCode}`) !== `errors.reasons.${item.errorCode}` ? t(`errors.reasons.${item.errorCode}`) : item.errorMessage}</span>
          {item.errorIssues.length ? (
            <ul className="mt-1 list-disc ps-4 font-mono text-[11px]">
              {item.errorIssues.slice(0, 6).map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}

      {/* Toolbar */}
      {canManage && !editing ? (
        <div className="flex flex-wrap items-center gap-2">
          {ready ? (
            item.approved ? (
              <Button size="sm" variant="secondary" loading={busy === "approve"} onClick={() => call("approve", `${itemBase}/approve`, { approved: false })}>
                <X aria-hidden />
                {t("builder.kit.unapprove")}
              </Button>
            ) : (
              <Button size="sm" variant="luminous" loading={busy === "approve"} onClick={() => call("approve", `${itemBase}/approve`, { approved: true })}>
                <Check aria-hidden />
                {t("builder.kit.approve")}
              </Button>
            )
          ) : null}
          {ready && item.key !== "logo" ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setContent(item.content ?? "");
                setData(item.data ?? {});
                setEditing(true);
              }}
            >
              <Pencil aria-hidden />
              {t("builder.kit.edit.start")}
            </Button>
          ) : null}
          {item.status !== "GENERATING" && item.status !== "PENDING" ? (
            <>
              <Button size="sm" variant="secondary" loading={busy === "regenerate"} onClick={() => call("regenerate", `${itemBase}/regenerate`, feedback.trim() ? { feedback: feedback.trim() } : {})}>
                <RotateCcw aria-hidden />
                {item.status === "READY" ? t("builder.kit.regenerate") : t("builder.kit.tryAgain")}
              </Button>
              {item.kind === "ai" ? (
                <Button size="sm" variant="ghost" aria-expanded={feedbackOpen} onClick={() => setFeedbackOpen((o) => !o)}>
                  {t("builder.kit.withFeedback")}
                </Button>
              ) : null}
            </>
          ) : null}
          {item.brainDocumentId ? (
            <Button asChild size="sm" variant="ghost">
              <Link href={`/${locale}/brain/${item.brainDocumentId}`}>
                <FileText aria-hidden />
                {t("builder.kit.inBrain")}
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
      {feedbackOpen && !editing ? (
        <Textarea rows={2} maxLength={2000} value={feedback} onChange={(e) => setFeedback(e.target.value)} aria-label={t("builder.kit.withFeedback")} placeholder={t("builder.kit.feedbackPlaceholder")} />
      ) : null}
      <FormError error={error} />
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      {/* Editing */}
      {editing ? (
        <div className="grid gap-4 rounded-xl border border-primary/30 p-4">
          {item.hasSchema ? (
            <section className="grid gap-3">
              <h3 className="text-sm font-semibold">{t("builder.kit.edit.structured")}</h3>
              <StructuredEditor value={data} onChange={setData} enums={enums} />
            </section>
          ) : null}
          <section className="grid gap-2">
            <h3 className="text-sm font-semibold">{t("builder.kit.edit.writeup")}</h3>
            <Textarea rows={16} className="font-mono text-xs" value={content} onChange={(e) => setContent(e.target.value)} aria-label={t("builder.kit.edit.writeup")} />
          </section>
          <div className="flex flex-wrap gap-2">
            <Button loading={busy === "save"} onClick={save}>
              <Check aria-hidden />
              {t("builder.kit.edit.save")}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              {t("builder.kit.edit.cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {/* The deliverable */}
      {!editing && item.key === "logo" && logoUrls.length ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {logoUrls.map((l) => {
            const pinned = item.records.some((r) => r.kind === "brand_logo" && r.id === l.id);
            return (
              <figure key={l.id} className={cn("grid gap-2 rounded-xl border bg-white p-3", pinned && "ring-2 ring-success")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={l.url} alt={t("builder.kit.logo.alt", { name: companyName })} className="aspect-square w-full rounded-lg object-contain" loading="lazy" />
                {canManage && gates.pin_logo && ready ? (
                  <Button size="sm" variant={pinned ? "soft" : "secondary"} disabled={pinned} loading={busy === `pin_logo`} onClick={() => act("pin_logo", l.id)}>
                    <ImageIcon aria-hidden />
                    {pinned ? t("builder.kit.logo.isBrand") : t("builder.kit.logo.makeBrand")}
                  </Button>
                ) : null}
              </figure>
            );
          })}
        </div>
      ) : null}
      {!editing && item.key === "name_ideas" && item.data ? (
        <NameIdeas d={item.data} current={companyName} busy={busy === "use_name"} onUse={canManage && gates.use_name && ready ? (n) => act("use_name", n) : undefined} />
      ) : null}
      {!editing && item.data && (item.status === "READY" || item.status === "GENERATING" || item.status === "PENDING") ? <StructuredView itemKey={item.key} data={item.data} /> : null}

      {/* Turn this into action */}
      {!editing && ready && (item.actions.some((a) => !["use_name", "pin_logo"].includes(a)) || ["website_structure", "financial_forecast"].includes(item.key)) ? (
        <section className="grid gap-3 rounded-xl border bg-surface-2/50 p-4" aria-labelledby={`act-${item.key}`}>
          <div className="flex items-center gap-2">
            <Wand2 className="size-4 text-primary" aria-hidden />
            <h3 id={`act-${item.key}`} className="text-sm font-semibold">
              {t("builder.kit.actions.title")}
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {item.actions
              .filter((a) => !["use_name", "pin_logo"].includes(a))
              .map((a) => {
                const done = item.records.some((r) => r.action === a);
                const label = a === "use_workforce" ? t(journey ? "builder.kit.actions.use_workforce_journey" : "builder.kit.actions.use_workforce") : t(`builder.kit.actions.${a}`);
                return (
                  <Button key={a} size="sm" variant={done ? "secondary" : "default"} disabled={!canManage || !gates[a]} loading={busy === a} onClick={() => (!done || window.confirm(t("builder.kit.actions.again"))) && call(a, `${itemBase}/actions`, { action: a, again: done }).then((ok) => ok && setNotice(t(`builder.kit.actions.done.${a}`)))}>
                    {done ? <Check aria-hidden /> : <Sparkles aria-hidden />}
                    {label}
                  </Button>
                );
              })}
            {item.key === "financial_forecast" && item.data ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const rows = forecastRows(item.data!);
                  const head = ["month", "revenue", "costs", "net", "cumulative_cash", "note"];
                  const csv = [head.join(","), ...rows.map((r) => [r.month, r.revenue, r.costs, r.net, r.cash, r.note].map(csvCell).join(","))].join("\n");
                  download(`${companyName.replace(/[^\p{L}\p{N}]+/gu, "-")}-12-month-projection.csv`, `${csv}\n`, "text/csv;charset=utf-8");
                }}
              >
                <Download aria-hidden />
                {t("builder.kit.actions.exportCsv")}
              </Button>
            ) : null}
            {item.key === "website_structure" && item.data ? (
              <Button size="sm" variant="secondary" onClick={() => download(`${companyName.replace(/[^\p{L}\p{N}]+/gu, "-")}-website.md`, websiteMarkdown(item.data!, companyName), "text/markdown;charset=utf-8")}>
                <Download aria-hidden />
                {t("builder.kit.actions.exportSite")}
              </Button>
            ) : null}
          </div>
          {item.key === "website_structure" ? <p className="text-xs text-muted-foreground">{t("builder.kit.website.createSite")}</p> : null}
          {item.actions.some((a) => !gates[a] && !["use_name", "pin_logo"].includes(a)) ? <p className="text-xs text-muted-foreground">{t("builder.kit.actions.noPermission")}</p> : null}
          <RecordLinks records={item.records.filter((r) => !["brand_logo", "company_name"].includes(r.kind))} />
        </section>
      ) : null}

      {!editing && item.data ? <Sources d={item.data} /> : null}
      {!editing && item.data && typeof item.data.research === "string" && item.data.research === "not_connected" ? (
        <Notice
          tone="warning"
          title={t("builder.kit.research.unsourcedTitle")}
          action={
            <Button asChild size="sm" variant="secondary">
              <Link href={`/${locale}/integrations`}>
                <ExternalLink aria-hidden />
                {t("builder.kit.connect")}
              </Link>
            </Button>
          }
        >
          {t("builder.kit.research.unsourced")}
        </Notice>
      ) : null}

      {!editing && item.content && item.key !== "logo" ? (
        item.data && item.hasSchema ? (
          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer text-sm font-medium">{t("builder.kit.fullWriteup")}</summary>
            <Markdown text={item.content} className="mt-3" />
          </details>
        ) : (
          <div className="rounded-xl border p-4 sm:p-6">
            <Markdown text={item.content} />
          </div>
        )
      ) : null}
    </article>
  );
}

/** Start the kit for a run that has none yet. */
export function StartKitButton({ base }: { base: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="grid gap-2">
      <div>
        <Button
          size="xl"
          variant="luminous"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api(`${base}/kit`, { body: {} });
              router.refresh();
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Sparkles aria-hidden />
          {t("builder.kit.start")}
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}

/** Export the whole kit (every ready deliverable) as one Markdown file. */
export function ExportKitButton({ filename, text }: { filename: string; text: string }) {
  const { t } = useI18n();
  return (
    <Button size="sm" variant="secondary" onClick={() => download(filename, text, "text/markdown;charset=utf-8")}>
      <Download aria-hidden />
      {t("builder.kit.exportAll")}
    </Button>
  );
}
