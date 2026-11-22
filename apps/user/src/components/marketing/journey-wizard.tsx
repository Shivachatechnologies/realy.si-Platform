"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, ImagePlus, Rocket, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { AnimatedProgress } from "@/components/motion/animated-progress";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { PlatformPreview, platformForContent } from "./studio";

type Answers = {
  promote?: string;
  offerName?: string;
  offerDescription?: string;
  productId?: string;
  customers?: string;
  regions?: string;
  objective?: string;
  pace?: string;
  accountIds?: string[];
  autonomy?: string;
};
interface Task {
  id: string;
  status: string;
  output: string | null;
}
export interface JourneyProps {
  base: string;
  locale: string;
  brand: string;
  step: number;
  answers: Answers;
  products: { id: string; name: string; description: string | null }[];
  accounts: { id: string; name: string; provider: string; connected: boolean }[];
  strategy: Task | null;
  pack: Task | null;
  drafts: { id: string; type: string; title: string; body: string; brief: string | null; imageUrl: string | null }[];
  autopilotId: string | null;
  imageProvider: string | null;
  canManage: boolean;
}

const PROMOTE = ["product", "service", "event", "brand", "offer"] as const;
const OBJECTIVES = ["awareness", "leads", "sales", "traffic", "community"] as const;
const PACES = ["gentle", "steady", "active"] as const;
const STEPS = 8;

function Choice({ selected, onClick, title, body, recommended, t }: { selected: boolean; onClick: () => void; title: string; body: string; recommended?: boolean; t: ReturnType<typeof useT> }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className={cn("hover-lift grid gap-1 rounded-lg border p-4 text-start transition", selected ? "border-primary bg-accent shadow-glow" : "bg-surface")}>
      <span className="flex items-center justify-between gap-2 font-medium">
        {title}
        {selected ? <Check className="size-4 text-primary" aria-hidden /> : recommended ? <span className="rounded-full bg-accent px-2 text-[11px] text-accent-foreground">{t("marketing.studio.journey.recommended")}</span> : null}
      </span>
      <span className="text-xs text-muted-foreground">{body}</span>
    </button>
  );
}

function TaskState({ task, t }: { task: Task | null; t: ReturnType<typeof useT> }) {
  if (!task) return null;
  return (
    <p className="flex items-center gap-2 text-sm" role="status">
      <span className={cn("size-2 rounded-full", task.status === "COMPLETED" ? "bg-success" : task.status === "FAILED" || task.status === "CANCELLED" ? "bg-danger" : "animate-pulse bg-primary")} aria-hidden />
      {t(`agentTasks.status.${task.status}`)}
    </p>
  );
}

/** The guided "Start here" journey (8 steps, saved server-side after every step). */
export function JourneyWizard(p: JourneyProps) {
  const t = useT();
  const router = useRouter();
  const reduce = useReducedMotion();
  const [step, setStep] = useState(Math.min(Math.max(p.step, 1), STEPS));
  const [a, setA] = useState<Answers>({ promote: "product", objective: "leads", pace: "gentle", autonomy: "REVIEW_REQUIRED", accountIds: p.accounts.filter((x) => x.connected).map((x) => x.id), ...p.answers });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (patch: Answers) => setA((x) => ({ ...x, ...patch }));

  async function go(next: number, action?: { action: string; taskId?: string }) {
    setBusy(true);
    setError(null);
    try {
      const { accountIds, ...rest } = a;
      await api(`${p.base}/journey`, { method: "PUT", body: { step: next, answers: { ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== "")), accountIds } } });
      if (action) await api(`${p.base}/journey/actions`, { body: action });
      setStep(next);
      router.refresh();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function imageFor(d: JourneyProps["drafts"][number]) {
    setBusy(true);
    setError(null);
    try {
      const idea = d.brief?.split("\n").find((l) => l.startsWith("Image idea:"))?.replace("Image idea:", "").trim() || d.title;
      const platform = platformForContent(d.type);
      const preset = platform === "INSTAGRAM" ? "instagram_portrait" : platform === "LINKEDIN" ? "linkedin_post" : platform === "X" ? "x_post" : platform === "TIKTOK" ? "story_reel" : platform === "YOUTUBE" ? "youtube_thumbnail" : "facebook_post";
      const r = await api<{ created: string[] }>(`${p.base}/assets/generate`, { body: { prompt: idea, preset, variations: 1 } });
      if (r.created[0]) await api(`${p.base}/content/${d.id}`, { method: "PATCH", body: { featuredAssetId: r.created[0] } });
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const running = (task: Task | null) => !!task && (task.status === "QUEUED" || task.status === "RUNNING");
  const canNext: Record<number, boolean> = { 1: !!a.promote, 2: !!a.offerName?.trim(), 3: !!a.customers?.trim(), 4: !!a.objective, 5: p.strategy?.status === "COMPLETED", 6: p.drafts.length > 0, 7: !!a.pace && !!a.accountIds?.length };

  return (
    <Card variant="highlight" className="relative overflow-hidden p-4 sm:p-6">
      <AutoRefresh active={running(p.strategy) || running(p.pack)} />
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{t("marketing.studio.journey.stepOf", { step, total: STEPS })}</span>
          <span>{t(`marketing.studio.journey.s${step}.short`)}</span>
        </div>
        <AnimatedProgress value={(step / STEPS) * 100} label={t("marketing.studio.journey.progress")} />
        <ol className="hidden gap-1 sm:grid sm:grid-cols-8" aria-hidden>
          {Array.from({ length: STEPS }, (_, i) => (
            <li key={i} className={cn("truncate text-center text-[11px]", i + 1 === step ? "font-semibold text-primary" : i + 1 < step ? "text-foreground" : "text-muted-foreground")}>
              {t(`marketing.studio.journey.s${i + 1}.short`)}
            </li>
          ))}
        </ol>
      </div>

      <AnimatePresence mode="wait">
        <motion.section key={step} className="mt-6 grid gap-4" initial={reduce ? false : { opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={reduce ? undefined : { opacity: 0, x: -24 }} transition={{ duration: 0.25 }}>
          <header className="grid gap-1">
            <h2 className="text-lg font-semibold sm:text-xl">{t(`marketing.studio.journey.s${step}.title`)}</h2>
            <p className="text-sm text-muted-foreground">{t(`marketing.studio.journey.s${step}.hint`)}</p>
          </header>

          {step === 1 ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {PROMOTE.map((k) => (
                <Choice key={k} t={t} selected={a.promote === k} recommended={k === "product"} onClick={() => set({ promote: k })} title={t(`marketing.studio.journey.promote.${k}`)} body={t(`marketing.studio.journey.promote.${k}Hint`)} />
              ))}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-3 sm:max-w-xl">
              {p.products.length ? (
                <Field label={t("marketing.studio.journey.pickProduct")} htmlFor="j-product">
                  <Select id="j-product" value={a.productId ?? ""} onChange={(e) => {
                    const pr = p.products.find((x) => x.id === e.target.value);
                    set({ productId: e.target.value, offerName: pr?.name ?? a.offerName, offerDescription: pr?.description ?? a.offerDescription });
                  }}>
                    <option value="">{t("marketing.studio.journey.somethingElse")}</option>
                    {p.products.map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              <Field label={t("marketing.studio.journey.offerName")} htmlFor="j-name" hint={t("marketing.studio.journey.offerNameEx")}>
                <Input id="j-name" value={a.offerName ?? ""} maxLength={200} onChange={(e) => set({ offerName: e.target.value })} />
              </Field>
              <Field label={t("marketing.studio.journey.offerDescription")} htmlFor="j-desc" hint={t("marketing.studio.journey.offerDescriptionEx")}>
                <Textarea id="j-desc" rows={3} value={a.offerDescription ?? ""} maxLength={2000} onChange={(e) => set({ offerDescription: e.target.value })} />
              </Field>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-3 sm:max-w-xl">
              <Field label={t("marketing.studio.journey.customers")} htmlFor="j-cust" hint={t("marketing.studio.journey.customersEx")}>
                <Textarea id="j-cust" rows={4} value={a.customers ?? ""} maxLength={2000} onChange={(e) => set({ customers: e.target.value })} />
              </Field>
              <Field label={t("marketing.studio.journey.regions")} htmlFor="j-reg" hint={t("marketing.studio.journey.regionsEx")}>
                <Input id="j-reg" value={a.regions ?? ""} maxLength={300} onChange={(e) => set({ regions: e.target.value })} />
              </Field>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {OBJECTIVES.map((k) => (
                <Choice key={k} t={t} selected={a.objective === k} recommended={k === "leads"} onClick={() => set({ objective: k })} title={t(`marketing.studio.journey.objective.${k}`)} body={t(`marketing.studio.journey.objective.${k}Hint`)} />
              ))}
            </div>
          ) : null}

          {step === 5 ? (
            <div className="grid gap-3">
              {!p.strategy || p.strategy.status === "FAILED" || p.strategy.status === "CANCELLED" ? (
                <div>
                  <Button disabled={busy || !p.canManage} onClick={() => void go(5, { action: "strategy" })}>
                    <Sparkles aria-hidden />
                    {t("marketing.studio.journey.makeStrategy")}
                  </Button>
                </div>
              ) : null}
              <TaskState task={p.strategy} t={t} />
              {p.strategy?.status === "COMPLETED" && p.strategy.output ? (
                <div className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-lg border bg-surface-2 p-4 text-sm leading-relaxed">{p.strategy.output}</div>
              ) : running(p.strategy) ? (
                <p className="text-sm text-muted-foreground">{t("marketing.studio.journey.working")}</p>
              ) : null}
            </div>
          ) : null}

          {step === 6 ? (
            <div className="grid gap-4">
              {!p.drafts.length ? (
                <div className="flex flex-wrap items-center gap-3">
                  {!p.pack || p.pack.status === "FAILED" || p.pack.status === "CANCELLED" ? (
                    <Button disabled={busy || !p.canManage} onClick={() => void go(6, { action: "content_pack" })}>
                      <Sparkles aria-hidden />
                      {t("marketing.studio.journey.makePosts")}
                    </Button>
                  ) : p.pack.status === "COMPLETED" ? (
                    <Button disabled={busy || !p.canManage} onClick={() => void go(6, { action: "apply_content", taskId: p.pack!.id })}>
                      <Check aria-hidden />
                      {t("marketing.studio.journey.usePosts")}
                    </Button>
                  ) : null}
                  <TaskState task={p.pack} t={t} />
                </div>
              ) : null}
              {p.drafts.length ? (
                <>
                  {!p.imageProvider ? (
                    <Notice tone="info">{t("marketing.studio.journey.noImageProvider")}</Notice>
                  ) : null}
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {p.drafts.map((d, i) => {
                      const platform = platformForContent(d.type);
                      return (
                        <motion.div key={d.id} className="grid gap-2" initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduce ? 0 : i * 0.06 }}>
                          {platform ? <PlatformPreview platform={platform} brand={p.brand} text={d.body} mediaUrl={d.imageUrl} t={t} /> : <pre className="whitespace-pre-wrap rounded-lg border p-3 text-sm">{d.body}</pre>}
                          <div className="flex flex-wrap gap-2">
                            <Link href={`/${p.locale}/marketing/content/${d.id}`} className="text-xs underline">
                              {t("marketing.studio.journey.editPost")}
                            </Link>
                            {p.imageProvider && !d.imageUrl && p.canManage ? (
                              <button type="button" className="inline-flex items-center gap-1 text-xs text-primary underline" disabled={busy} onClick={() => void imageFor(d)}>
                                <ImagePlus className="size-3.5" aria-hidden />
                                {t("marketing.studio.journey.makeImage")}
                              </button>
                            ) : null}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {step === 7 ? (
            <div className="grid gap-4">
              <div>
                <p className="mb-2 text-sm font-medium">{t("marketing.studio.journey.howOften")}</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {PACES.map((k) => (
                    <Choice key={k} t={t} selected={a.pace === k} recommended={k === "gentle"} onClick={() => set({ pace: k })} title={t(`marketing.studio.journey.pace.${k}`)} body={t(`marketing.studio.journey.pace.${k}Hint`)} />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">{t("marketing.studio.journey.where")}</p>
                {p.accounts.length ? (
                  <div className="flex flex-wrap gap-2">
                    {p.accounts.map((acc) => {
                      const on = a.accountIds?.includes(acc.id) ?? false;
                      return (
                        <label key={acc.id} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm", on ? "border-primary bg-accent" : "")}>
                          <input type="checkbox" checked={on} onChange={() => set({ accountIds: on ? a.accountIds!.filter((x) => x !== acc.id) : [...(a.accountIds ?? []), acc.id] })} />
                          {acc.name} · {t(`marketing.provider.${acc.provider}`)}
                          {!acc.connected ? <span className="text-xs text-warning">{t("common.notConnected")}</span> : null}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <Notice tone="warning">
                    {t("marketing.studio.journey.noAccounts")}{" "}
                    <Link className="underline" href={`/${p.locale}/marketing/social`}>
                      {t("marketing.studio.journey.addAccounts")}
                    </Link>
                  </Notice>
                )}
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">{t("marketing.studio.journey.approval")}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Choice t={t} selected={a.autonomy === "REVIEW_REQUIRED"} recommended onClick={() => set({ autonomy: "REVIEW_REQUIRED" })} title={t("marketing.studio.journey.reviewEach")} body={t("marketing.studio.journey.reviewEachHint")} />
                  <Choice t={t} selected={a.autonomy === "AUTO_PUBLISH"} onClick={() => set({ autonomy: "AUTO_PUBLISH" })} title={t("marketing.studio.journey.autoPublish")} body={t("marketing.studio.journey.autoPublishHint")} />
                </div>
              </div>
            </div>
          ) : null}

          {step === 8 ? (
            <div className="grid gap-3">
              <Notice tone="success">{t("marketing.studio.journey.live")}</Notice>
              <div className="flex flex-wrap gap-2">
                {p.autopilotId ? (
                  <Link className="rounded-md border px-3 py-2 text-sm hover:bg-accent" href={`/${p.locale}/marketing/autopilot/${p.autopilotId}`}>
                    {t("marketing.studio.journey.openAutopilot")}
                  </Link>
                ) : null}
                <Link className="rounded-md border px-3 py-2 text-sm hover:bg-accent" href={`/${p.locale}/marketing/analytics`}>
                  {t("marketing.studio.journey.openAnalytics")}
                </Link>
                <Link className="rounded-md border px-3 py-2 text-sm hover:bg-accent" href={`/${p.locale}/marketing?view=studio`}>
                  {t("marketing.studio.journey.openStudio")}
                </Link>
              </div>
            </div>
          ) : null}
        </motion.section>
      </AnimatePresence>

      <FormError error={error} />
      <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <Button variant="ghost" disabled={busy || step === 1} onClick={() => setStep((s) => Math.max(1, s - 1))}>
          <ArrowLeft aria-hidden className="rtl:rotate-180" />
          {t("marketing.studio.journey.back")}
        </Button>
        {step < 7 ? (
          <Button disabled={busy || !canNext[step] || !p.canManage} onClick={() => void go(step + 1)}>
            {t("marketing.studio.journey.next")}
            <ArrowRight aria-hidden className="rtl:rotate-180" />
          </Button>
        ) : step === 7 ? (
          <Button disabled={busy || !canNext[7] || !p.canManage} onClick={() => void go(7, { action: "launch" }).then((ok) => ok && setStep(8))}>
            <Rocket aria-hidden />
            {t("marketing.studio.journey.launch")}
          </Button>
        ) : null}
      </footer>
    </Card>
  );
}
