"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, CircleHelp, ListChecks, RotateCcw, Save, Sparkles, Wand2 } from "lucide-react";
import { FormError } from "@/components/form-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import type { Definition, DefinitionIssue } from "@/server/modules/automation/definition";
import { FlowView } from "./flow-view";

interface ComposeResult {
  source: "ai" | "rules";
  aiStatus: "used" | "not_connected" | "paused" | "invalid_design" | "error";
  name: string;
  notes: { phrase: string; target: string | null }[];
  unmatched: string[];
  definition: Definition | null;
  issues: DefinitionIssue[];
}

const EXAMPLES = ["lead", "deal", "ticket", "invoice", "weekly"] as const;

/**
 * "Tell Realy.si what to automate": plain words → a real, validated workflow definition (AI when a text provider is
 * connected, otherwise the clearly-labelled rule-based parser) → visual flow for review → saved as a draft. Turning it
 * on happens on the workflow page after publishing.
 */
export function NlComposer({ base }: { base: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const reduced = useReducedMotion();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"compose" | "save" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<ComposeResult | null>(null);
  const [name, setName] = useState("");

  async function compose() {
    setBusy("compose");
    setError(null);
    try {
      const r = await api<ComposeResult>(`${base}/workflows/compose`, { method: "POST", body: { text } });
      setResult(r);
      setName(r.name);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!result?.definition) return;
    setBusy("save");
    setError(null);
    try {
      const r = await api<{ id: string }>(`${base}/workflows/compose/save`, { method: "POST", body: { name: name.trim() || result.name, text, source: result.source, definition: result.definition } });
      router.push(`/${locale}/workflows/${r.id}`);
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  }

  const canSave = Boolean(result?.definition && !result.issues.length && result.definition.steps.length);
  const understood = result?.notes.filter((n) => n.target) ?? [];

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <label htmlFor="nl-automation" className="sr-only">
          {t("workflows.compose.label")}
        </label>
        <Textarea
          id="nl-automation"
          rows={3}
          minLength={10}
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && text.trim().length >= 10 && !busy) void compose();
          }}
          placeholder={t("workflows.compose.placeholder")}
          className="font-display text-lg leading-relaxed"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t("workflows.compose.tryOne")}</span>
          {EXAMPLES.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setText(t(`workflows.compose.examples.${k}`));
                setResult(null);
              }}
              className="min-h-8 rounded-full border bg-surface px-3 text-xs transition-colors hover:border-primary/50 hover:text-primary"
            >
              {t(`workflows.compose.exampleLabels.${k}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" magnetic onClick={compose} disabled={busy !== null || text.trim().length < 10} aria-busy={busy === "compose"}>
          <Wand2 aria-hidden /> {busy === "compose" ? t("workflows.compose.building") : t("workflows.compose.build")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("workflows.compose.safeNote")}</span>
      </div>
      <FormError error={error} />

      <AnimatePresence mode="wait">
        {result ? (
          <motion.div key={JSON.stringify(result.definition)?.length ?? 0} initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, y: -8 }} className="grid gap-4 rounded-xl border bg-surface-2/40 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              {result.source === "ai" ? (
                <Badge tone="brand" shape="pill">
                  <Sparkles className="size-3" aria-hidden /> {t("workflows.compose.sourceAi")}
                </Badge>
              ) : (
                <Badge tone="info" shape="pill">
                  <ListChecks className="size-3" aria-hidden /> {t("workflows.compose.sourceRules")}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">{t(`workflows.compose.aiStatus.${result.aiStatus}`)}</span>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div className="min-w-0">
                <p className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("workflows.compose.flowTitle")}</p>
                {result.definition ? <FlowView definition={result.definition} /> : <Notice tone="warning">{t("workflows.compose.nothingUnderstood")}</Notice>}
              </div>
              <div className="grid content-start gap-4">
                {understood.length ? (
                  <div className="grid gap-2">
                    <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("workflows.compose.understood")}</p>
                    <ul className="grid gap-1.5 text-sm">
                      {understood.map((n, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-success rtl:rotate-180" aria-hidden />
                          <span>
                            “{n.phrase}” <span className="text-muted-foreground">→ {n.target === "trigger" ? t("workflows.compose.theTrigger") : n.target}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {result.unmatched.length ? (
                  <Notice tone="warning" title={t("workflows.compose.unmatchedTitle")}>
                    <ul className="mt-1 grid gap-1">
                      {result.unmatched.map((u, i) => (
                        <li key={i}>“{u}”</li>
                      ))}
                    </ul>
                    <p className="mt-1 text-xs">{t("workflows.compose.unmatchedHint")}</p>
                  </Notice>
                ) : null}
                {result.issues.length ? (
                  <Notice tone="danger" title={t("workflows.compose.issuesTitle")}>
                    <ul className="mt-1 grid gap-1 text-xs">
                      {result.issues.map((i, k) => (
                        <li key={k}>
                          <code>{i.path}</code>: {i.message}
                        </li>
                      ))}
                    </ul>
                  </Notice>
                ) : null}
                <div className="flex items-start gap-2 rounded-lg border bg-surface p-3 text-xs text-muted-foreground">
                  <CircleHelp className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <p>{t("workflows.compose.reviewHint")}</p>
                </div>
                {canSave ? (
                  <div className="grid gap-3">
                    <Field label={t("workflows.simple.name")} htmlFor="nl-name">
                      <Input id="nl-name" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" onClick={save} disabled={busy !== null} aria-busy={busy === "save"}>
                        <Save aria-hidden /> {t("workflows.compose.saveDraft")}
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setResult(null)} disabled={busy !== null}>
                        <RotateCcw aria-hidden /> {t("workflows.compose.startOver")}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">{t("workflows.compose.afterSave")}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
