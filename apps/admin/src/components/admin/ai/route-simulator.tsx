"use client";

import { useState } from "react";
import { Route } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";

interface Sim {
  classification: { tier: string; score: number; reasons: string[] };
  override: string | null;
  complexityTier: string;
  workTier: string | null;
  orgPinned: string | null;
  steps: { step: string; model: string | null; used: boolean }[];
  model: string;
  provider: string;
  providerConfigured: boolean;
  allowed: boolean;
  breakerOpen: boolean;
  killSwitch: boolean;
  fallbackChain: { model: string; provider: string; configured: boolean; breakerOpen: boolean }[];
}

/** Effective-route simulator: the same deterministic routing as the runtime, without calling a model. */
export function RouteSimulator({ profiles }: { profiles: string[] }) {
  const { t } = useI18n();
  const [org, setOrg] = useState("");
  const [profile, setProfile] = useState(profiles[0] ?? "");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [operation, setOperation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [r, setR] = useState<Sim | null>(null);
  return (
    <div className="grid gap-3 p-4">
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            setR(await api<Sim>("/api/v1/admin/ai/route-simulator", { method: "POST", body: { organizationId: org.trim() || null, profile, title, instructions, ...(operation.trim() ? { operation: operation.trim() } : {}) } }));
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("admin.aiModels.simOrg")} htmlFor="sim-org">
            <Input id="sim-org" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="00000000-…" className="font-mono" spellCheck={false} />
          </Field>
          <Field label={t("admin.aiModels.simProfile")} htmlFor="sim-profile">
            <Select id="sim-profile" value={profile} onChange={(e) => setProfile(e.target.value)}>
              {profiles.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("admin.aiModels.simOperation")} htmlFor="sim-op">
            <Input id="sim-op" value={operation} onChange={(e) => setOperation(e.target.value)} placeholder="voiceos.answer" className="font-mono" spellCheck={false} />
          </Field>
        </div>
        <Field label={t("admin.aiModels.simTitle")} htmlFor="sim-title">
          <Input id="sim-title" maxLength={500} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t("admin.aiModels.simInstructions")} htmlFor="sim-ins">
          <Textarea id="sim-ins" rows={3} maxLength={20000} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || !profile}>
            <Route />
            {t("admin.aiModels.simulate")}
          </Button>
        </div>
      </form>
      <FormError error={error} />
      {r ? (
        <div className="grid gap-2 rounded-md border bg-surface-2 p-3 text-sm" role="status">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold">{r.model}</span>
            <Badge tone="accent">{r.provider}</Badge>
            <Badge tone="neutral">{t(`admin.aiModels.tier.${r.workTier ?? r.complexityTier}`)}</Badge>
            {!r.providerConfigured ? <Badge tone="danger">{t("admin.aiModels.notConfigured")}</Badge> : null}
            {!r.allowed ? <Badge tone="danger">{t("admin.aiModels.notAllowed")}</Badge> : null}
            {r.breakerOpen ? <Badge tone="warning">{t("admin.aiModels.breakerOpen")}</Badge> : null}
            {r.killSwitch ? <Badge tone="danger">{t("admin.aiModels.simKillSwitch")}</Badge> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("admin.aiModels.simClassified", { tier: r.classification.tier, score: r.classification.score })} · <span className="font-mono">{r.classification.reasons.join(", ") || "—"}</span>
            {r.override ? ` · ${t("admin.aiModels.simOverride", { tier: r.override })}` : ""}
            {r.orgPinned ? ` · ${t("admin.aiModels.simPinned", { model: r.orgPinned })}` : ""}
          </p>
          <ol className="grid gap-1 text-xs">
            {r.steps.map((s) => (
              <li key={s.step} className="flex gap-2">
                <span className="w-32 shrink-0 font-mono text-muted-foreground">{s.step}</span>
                <span className={s.used ? "font-mono font-medium" : "font-mono text-muted-foreground line-through"}>{s.model ?? "—"}</span>
              </li>
            ))}
          </ol>
          {r.fallbackChain.length ? (
            <p className="text-xs">
              {t("admin.aiModels.fallbackChain")}:{" "}
              {r.fallbackChain.map((f, i) => (
                <span key={f.model} className="font-mono">
                  {i ? " → " : ""}
                  {f.model}
                  {!f.configured ? ` (${t("admin.aiModels.notConfigured")})` : f.breakerOpen ? ` (${t("admin.aiModels.breakerOpen")})` : ""}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
