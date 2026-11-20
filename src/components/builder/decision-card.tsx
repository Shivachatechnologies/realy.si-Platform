"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, PenLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface Named {
  name: string;
  description?: string;
}
interface Options {
  current?: string;
  nameIdeas?: { name: string; rationale?: string }[];
  departments?: (Named & { teams?: Named[] })[];
  aiEmployees?: (Named & { profile: string })[];
  projects?: { name: string; tasks?: { title: string }[] }[];
  workflows?: (Named & { trigger: string })[];
  pipelines?: { name: string; stages: string[] }[];
}

function PickItem({ name, excluded, onToggle, disabled, children }: { name: string; excluded: boolean; onToggle: (name: string) => void; disabled: boolean; children: React.ReactNode }) {
  return (
    <label className={cn("flex items-start gap-2 rounded-md border p-2 text-sm", excluded && "opacity-60")}>
      <input type="checkbox" className="mt-0.5" checked={!excluded} onChange={() => onToggle(name)} disabled={disabled} />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

const SECTIONS = ["departments", "aiEmployees", "projects", "workflows", "pipelines"] as const;

/** A decision the run paused for: choose a name, approve the proposed structure / configuration, or ask for a revision. */
export function DecisionCard({ base, decision, canManage }: { base: string; decision: { id: string; kind: string; options: unknown }; canManage: boolean }) {
  const t = useT();
  const router = useRouter();
  const o = (decision.options ?? {}) as Options;
  const [value, setValue] = useState(o.nameIdeas?.[0]?.name ?? "");
  const [custom, setCustom] = useState("");
  const [exclude, setExclude] = useState<string[]>([]);
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/decisions/${decision.id}`, { body });
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  const toggle = (name: string) => setExclude((x) => (x.includes(name) ? x.filter((n) => n !== name) : [...x, name]));
  return (
    <Card variant="highlight">
      <CardHeader title={t(`builder.decisions.kinds.${decision.kind}.title`)} description={t(`builder.decisions.kinds.${decision.kind}.description`)} actions={<Badge tone="warning">{t("builder.decisions.awaiting")}</Badge>} />
      <CardBody className="grid gap-4">
        {decision.kind === "NAME" ? (
          <fieldset className="grid gap-2">
            <legend className="sr-only">{t(`builder.decisions.kinds.NAME.title`)}</legend>
            {(o.nameIdeas ?? []).map((n) => (
              <label key={n.name} className={cn("flex items-start gap-2 rounded-md border p-2 text-sm", value === n.name && !custom && "border-primary bg-accent/40")}>
                <input type="radio" name={`name-${decision.id}`} className="mt-0.5" checked={value === n.name && !custom} onChange={() => (setValue(n.name), setCustom(""))} disabled={!canManage} />
                <span>
                  <span className="font-medium">{n.name}</span>
                  {n.rationale ? <span className="block text-xs text-muted-foreground">{n.rationale}</span> : null}
                </span>
              </label>
            ))}
            <Input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={120} placeholder={t("builder.decisions.customName")} aria-label={t("builder.decisions.customName")} disabled={!canManage} />
            {o.current ? <p className="text-xs text-muted-foreground">{t("builder.decisions.currentName", { name: o.current })}</p> : null}
          </fieldset>
        ) : (
          SECTIONS.filter((s) => (o[s]?.length ?? 0) > 0).map((s) => (
            <section key={s} className="grid gap-2">
              <h3 className="text-sm font-medium">{t(`builder.sections.${s}`)}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {s === "departments" &&
                  o.departments!.map((d) => (
                    <PickItem key={d.name} name={d.name} excluded={exclude.includes(d.name)} onToggle={toggle} disabled={!canManage}>
                      <span className="font-medium">{d.name}</span>
                      {d.description ? <span className="block text-xs text-muted-foreground">{d.description}</span> : null}
                      {d.teams?.length ? <span className="block text-xs">{t("builder.decisions.teams", { list: d.teams.map((x) => x.name).join(", ") })}</span> : null}
                    </PickItem>
                  ))}
                {s === "aiEmployees" &&
                  o.aiEmployees!.map((e) => (
                    <PickItem key={e.name} name={e.name} excluded={exclude.includes(e.name)} onToggle={toggle} disabled={!canManage}>
                      <span className="font-medium">{e.name}</span> <span className="text-xs text-muted-foreground">· {t(`profiles.${e.profile}.name`)}</span>
                      {e.description ? <span className="block text-xs text-muted-foreground">{e.description}</span> : null}
                    </PickItem>
                  ))}
                {s === "projects" &&
                  o.projects!.map((p) => (
                    <PickItem key={p.name} name={p.name} excluded={exclude.includes(p.name)} onToggle={toggle} disabled={!canManage}>
                      <span className="font-medium">{p.name}</span>
                      <span className="block text-xs text-muted-foreground">{t("builder.decisions.tasks", { count: p.tasks?.length ?? 0 })}</span>
                    </PickItem>
                  ))}
                {s === "workflows" &&
                  o.workflows!.map((w) => (
                    <PickItem key={w.name} name={w.name} excluded={exclude.includes(w.name)} onToggle={toggle} disabled={!canManage}>
                      <span className="font-medium">{w.name}</span> <span className="font-mono text-[11px] text-muted-foreground">{w.trigger}</span>
                      {w.description ? <span className="block text-xs text-muted-foreground">{w.description}</span> : null}
                    </PickItem>
                  ))}
                {s === "pipelines" &&
                  o.pipelines!.map((p) => (
                    <PickItem key={p.name} name={p.name} excluded={exclude.includes(p.name)} onToggle={toggle} disabled={!canManage}>
                      <span className="font-medium">{p.name}</span>
                      <span className="block text-xs text-muted-foreground">{p.stages.join(" → ")}</span>
                    </PickItem>
                  ))}
              </div>
            </section>
          ))
        )}
        {revising ? (
          <Textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={2000} placeholder={t("builder.decisions.feedbackPlaceholder")} aria-label={t("builder.decisions.feedback")} />
        ) : null}
        <FormError error={error} />
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            {revising ? (
              <>
                <Button loading={busy} disabled={!feedback.trim()} onClick={() => send({ action: "revise", feedback: feedback.trim() })}>
                  {t("builder.decisions.sendRevision")}
                </Button>
                <Button variant="ghost" onClick={() => setRevising(false)}>
                  {t("common.cancel")}
                </Button>
              </>
            ) : (
              <>
                <Button
                  loading={busy}
                  disabled={decision.kind === "NAME" && !(custom.trim() || value)}
                  onClick={() => send(decision.kind === "NAME" ? { action: "approve", value: custom.trim() || value } : { action: "approve", exclude })}
                >
                  <Check aria-hidden />
                  {t(`builder.decisions.kinds.${decision.kind}.approve`)}
                </Button>
                <Button variant="secondary" onClick={() => setRevising(true)}>
                  <PenLine aria-hidden />
                  {t("builder.decisions.revise")}
                </Button>
              </>
            )}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
