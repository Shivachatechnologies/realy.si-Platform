"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, Check, Globe, Mail, MessageCircle, MessageSquareText, Sparkles } from "lucide-react";
import { FormError } from "@/components/form-error";
import { AnimatedProgress } from "@/components/motion/animated-progress";
import { isActive, useAgentTask, type LiveTask } from "@/components/guide-kit/use-agent-task";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { InboundStatusNotes, type InboundStatus } from "./settings";

type Step = "channels" | "promises" | "articles" | "done";

function useSaveStep(base: string) {
  const router = useRouter();
  return async (body: Record<string, unknown>, step: Step) => {
    await api(`${base}/support/settings`, { method: "PATCH", body: { ...body, setupStep: step } });
    router.refresh();
  };
}

/** Step 1: how customers reach you (web form, help center, email). */
export function ChannelsStep({
  base,
  initial,
  emailReady,
  inbound,
  links,
}: {
  base: string;
  initial: { supportFormEnabled: boolean; helpCenterEnabled: boolean; emailChannelEnabled: boolean; whatsappChannelEnabled: boolean; supportEmail: string | null };
  emailReady: boolean;
  inbound: InboundStatus;
  links: { form: string; help: string };
}) {
  const { t } = useI18n();
  const save = useSaveStep(base);
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cards = [
    { key: "supportFormEnabled" as const, icon: <MessageSquareText />, rec: true, link: links.form },
    { key: "helpCenterEnabled" as const, icon: <BookOpen />, rec: true, link: links.help },
    { key: "emailChannelEnabled" as const, icon: <Mail />, rec: false, link: null },
    { key: "whatsappChannelEnabled" as const, icon: <MessageCircle />, rec: false, link: null },
  ];
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <label key={c.key} className={cn("hover-lift grid cursor-pointer content-start gap-2 rounded-lg border p-4 text-sm", v[c.key] && "border-primary bg-primary/5 shadow-glow")}>
            <span className="flex items-center gap-2">
              <input type="checkbox" checked={v[c.key]} onChange={(e) => setV((x) => ({ ...x, [c.key]: e.target.checked }))} className="accent-(--primary)" />
              <span className="text-primary [&_svg]:size-4">{c.icon}</span>
              <span className="font-medium">{t(`support.setup.channels.${c.key}.label`)}</span>
              {c.rec ? <Badge tone="brand" shape="pill">{t("support.setup.recommended")}</Badge> : null}
            </span>
            <span className="text-muted-foreground">{t(`support.setup.channels.${c.key}.hint`)}</span>
            {c.link && v[c.key] ? (
              <a href={c.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <Globe className="size-3" aria-hidden /> {t("support.setup.channels.preview")}
              </a>
            ) : null}
          </label>
        ))}
      </div>
      {v.emailChannelEnabled ? (
        <div className="grid max-w-xl gap-2">
          <Field label={t("support.setup.channels.address")} htmlFor="sup-email" hint={t("support.setup.channels.addressHint")}>
            <Input id="sup-email" type="email" maxLength={254} value={v.supportEmail ?? ""} onChange={(e) => setV((x) => ({ ...x, supportEmail: e.target.value }))} placeholder="help@example.com" />
          </Field>
          <Notice tone={emailReady ? "success" : "warning"}>{t(emailReady ? "support.setup.channels.emailReady" : "support.setup.channels.emailNotReady")}</Notice>
        </div>
      ) : null}
      <InboundStatusNotes status={inbound} supportEmail={v.supportEmail} emailOn={v.emailChannelEnabled && !!v.supportEmail} whatsappOn={v.whatsappChannelEnabled} />
      <FormError error={error} />
      <div>
        <Button
          type="button"
          disabled={busy || (!v.supportFormEnabled && !v.helpCenterEnabled && !v.emailChannelEnabled && !v.whatsappChannelEnabled)}
          aria-busy={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await save({ ...v, supportEmail: v.emailChannelEnabled ? v.supportEmail || null : v.supportEmail }, "promises");
            } catch (e) {
              setError(e);
              setBusy(false);
            }
          }}
        >
          {t("support.setup.saveNext")} <ArrowRight className="rtl:-scale-x-100" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

const RESPOND = ["1h", "4h", "1d", "2d"] as const;
const RESOLVE = ["1d", "3d", "1w"] as const;

/** Step 2: response-time promises in plain words → SLA policy. */
export function PromiseStep({ base, initial }: { base: string; initial: { respond: (typeof RESPOND)[number]; resolve: (typeof RESOLVE)[number]; businessHoursOnly: boolean } }) {
  const { t } = useI18n();
  const save = useSaveStep(base);
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const group = <K extends "respond" | "resolve">(key: K, options: readonly string[], rec: string) => (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-[13px] font-medium">{t(`support.setup.promise.${key}Label`)}</legend>
      <div className="grid gap-2 sm:grid-cols-4">
        {options.map((o) => (
          <label key={o} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm", v[key] === o && "border-primary bg-primary/5")}>
            <input type="radio" name={key} checked={v[key] === o} onChange={() => setV((x) => ({ ...x, [key]: o }))} className="accent-(--primary)" />
            {t(`support.setup.promise.${key}.${o}`)}
            {o === rec ? <Badge tone="brand" shape="pill">{t("support.setup.recommended")}</Badge> : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
  return (
    <div className="grid gap-5">
      {group("respond", RESPOND, "4h")}
      {group("resolve", RESOLVE, "3d")}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.businessHoursOnly} onChange={(e) => setV((x) => ({ ...x, businessHoursOnly: e.target.checked }))} className="accent-(--primary)" />
        {t("support.setup.promise.businessHours")}
      </label>
      <Notice tone="info" title={t("support.setup.promise.previewTitle")}>
        {t("support.setup.promise.preview", { respond: t(`support.setup.promise.respond.${v.respond}`), resolve: t(`support.setup.promise.resolve.${v.resolve}`) })}
      </Notice>
      <FormError error={error} />
      <div>
        <Button
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api(`${base}/support/setup/promise`, { method: "POST", body: v });
              await save({}, "articles");
            } catch (e) {
              setError(e);
              setBusy(false);
            }
          }}
        >
          {t("support.setup.saveNext")} <ArrowRight className="rtl:-scale-x-100" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

const TOPICS = ["contact", "start", "account", "billing", "refunds", "shipping"] as const;

/** Step 3: first help articles — AI drafts (real tasks) that the person edits and saves as articles. */
export function ArticlesStep({ base, aiReady, drafts, locale }: { base: string; aiReady: boolean; drafts: LiveTask[]; locale: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const save = useSaveStep(base);
  const [picked, setPicked] = useState<string[]>(["contact", "start", "billing"]);
  const [custom, setCustom] = useState("");
  const [tasks, setTasks] = useState<LiveTask[]>(drafts);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function draft() {
    setBusy(true);
    setError(null);
    try {
      const topics = [...picked.map((k) => t(`support.setup.articles.topics.${k}`)), ...(custom.trim() ? [custom.trim()] : [])];
      const created: LiveTask[] = [];
      for (const topic of topics) {
        const r = await api<LiveTask>(`${base}/support/setup/articles`, { method: "POST", body: { topic } });
        created.push({ id: r.id, title: r.title, status: r.status, output: null });
      }
      setTasks((x) => [...created, ...x]);
      setCustom("");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-5">
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[13px] font-medium">{t("support.setup.articles.pick")}</legend>
        <div className="flex flex-wrap gap-2">
          {TOPICS.map((k) => (
            <label key={k} className={cn("flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm", picked.includes(k) && "border-primary bg-primary/5")}>
              <input type="checkbox" checked={picked.includes(k)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, k] : p.filter((x) => x !== k)))} className="accent-(--primary)" />
              {t(`support.setup.articles.topics.${k}`)}
            </label>
          ))}
        </div>
        <Input className="max-w-md" maxLength={200} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t("support.setup.articles.custom")} aria-label={t("support.setup.articles.custom")} />
      </fieldset>
      {aiReady ? (
        <div>
          <Button type="button" onClick={draft} disabled={busy || (!picked.length && !custom.trim())} aria-busy={busy}>
            <Sparkles aria-hidden /> {t("support.setup.articles.draft", { count: picked.length + (custom.trim() ? 1 : 0) })}
          </Button>
        </div>
      ) : (
        <Notice tone="warning">
          {t("support.setup.aiNotReady")}{" "}
          <Link href={`/${locale}/support/knowledge`} className="underline">
            {t("support.setup.articles.writeYourself")}
          </Link>
        </Notice>
      )}
      <FormError error={error} />
      {tasks.length ? (
        <div className="grid gap-3">
          {tasks.map((x) => (
            <ArticleDraft key={x.id} base={base} initial={x} />
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button
          type="button"
          variant={tasks.length ? "default" : "secondary"}
          onClick={async () => {
            try {
              await save({}, "done");
              router.push(`/${locale}/support`);
            } catch (e) {
              setError(e);
            }
          }}
        >
          <Check aria-hidden /> {t("support.setup.finish")}
        </Button>
      </div>
    </div>
  );
}

function ArticleDraft({ base, initial }: { base: string; initial: LiveTask }) {
  const { t, locale } = useI18n();
  const { task } = useAgentTask(base, initial);
  const [title, setTitle] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const running = isActive(task?.status);
  const out = task?.status === "COMPLETED" ? (task.output ?? "") : "";
  const lines = out.trim().split("\n");
  const head = lines[0]?.match(/^#\s+(.+)/)?.[1]?.trim();
  const fallbackTitle = (task?.title ?? "").replace(/^Help article:\s*/, "");
  const curTitle = title ?? (head ?? fallbackTitle).slice(0, 200);
  const curBody = body ?? (head ? lines.slice(1).join("\n").trim() : out.trim());
  async function store(status: "DRAFT" | "PUBLISHED") {
    setBusy(true);
    setError(null);
    try {
      const a = await api<{ id: string }>(`${base}/support/kb/articles`, { method: "POST", body: { title: curTitle, body: curBody, status } });
      setSaved(a.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-2 rounded-lg border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={task?.status === "COMPLETED" ? "success" : task?.status === "FAILED" ? "danger" : "info"} pulse={running}>
          {t(`guideKit.help.status.${task?.status ?? "QUEUED"}`)}
        </Badge>
        <span className="min-w-0 flex-1 truncate font-medium">{task?.title}</span>
        <Link href={`/${locale}/tasks/${initial.id}`} className="text-xs text-primary hover:underline">
          {t("guideKit.help.open")}
        </Link>
      </div>
      {running ? <AnimatedProgress label={t("guideKit.help.working")} active /> : null}
      {task?.status === "FAILED" ? <p className="text-xs text-danger">{task.errorMessage || t("guideKit.help.failed")}</p> : null}
      {out && !saved ? (
        <>
          <Input aria-label={t("support.setup.articles.title")} maxLength={200} value={curTitle} onChange={(e) => setTitle(e.target.value)} />
          <Textarea aria-label={t("support.setup.articles.body")} rows={8} maxLength={100000} value={curBody} onChange={(e) => setBody(e.target.value)} />
          <FormError error={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => store("PUBLISHED")} disabled={busy || !curTitle.trim() || !curBody.trim()}>
              {t("support.setup.articles.publish")}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => store("DRAFT")} disabled={busy || !curTitle.trim() || !curBody.trim()}>
              {t("support.setup.articles.saveDraft")}
            </Button>
          </div>
        </>
      ) : null}
      {saved ? (
        <Notice tone="success">
          {t("support.setup.articles.saved")}{" "}
          <Link href={`/${locale}/support/knowledge/${saved}`} className="underline">
            {t("support.setup.articles.open")}
          </Link>
        </Notice>
      ) : null}
    </div>
  );
}
