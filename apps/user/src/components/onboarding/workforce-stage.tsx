"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Crown, Plus, Trash2, UserCog, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { AiCore, SuccessBurst } from "@/components/motion";
import { AiAvatar } from "@/components/graphics/ai-avatar";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { RetryStep } from "@/components/builder/run-controls";
import type { WorkforcePlan } from "@/server/modules/builder/steps";

type Member = WorkforcePlan["team"][number];
type Level = Member["level"];
const RANK: Record<Level, number> = { EXECUTIVE: 0, MANAGER: 1, SPECIALIST: 2 };

export interface RoleOption {
  key: string;
  name: string;
  department: string;
  level: Level;
}

interface Props {
  base: string;
  runId: string;
  canHire: boolean;
  aiOk: boolean;
  mode: "approved" | "proposal" | "draft" | "starter" | "waiting";
  initial: WorkforcePlan | null;
  roles: RoleOption[];
  goals: string[];
  decisionId: string | null;
  stepStatus: string | null;
  stepError: string | null;
  stepId: string | null;
  hired: { created: number; skipped: number } | null;
}

function MemberCard({ m, role, selected, onSelect, levelLabel }: { m: Member; role: RoleOption | undefined; selected: boolean; onSelect: () => void; levelLabel: string }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "relative flex w-full min-w-0 items-center gap-2.5 rounded-2xl border bg-surface p-2.5 text-start shadow-elev-1 transition-[border-color,box-shadow] hover:border-primary",
        selected && "border-primary shadow-glow",
        m.level === "EXECUTIVE" && "bg-[linear-gradient(160deg,var(--world-soft,var(--accent)),var(--surface)_70%)]",
      )}
    >
      <AiAvatar seed={`${m.key}:${m.profile}`} department={role?.department} size={40} active={selected} />
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-sm font-semibold">{m.name || "—"}</span>
        <span className="truncate text-xs text-muted-foreground">{m.title || role?.name || m.profile}</span>
      </span>
      <Badge tone={m.level === "EXECUTIVE" ? "brand" : m.level === "MANAGER" ? "accent" : "neutral"} shape="pill">
        {m.level === "EXECUTIVE" ? <Crown className="size-3" aria-hidden /> : null}
        {levelLabel}
      </Badge>
    </button>
  );
}

/**
 * Stage 5 — AI Workforce: the proposed AI team as a living org chart (CEO → managers → specialists) with each AI
 * employee's responsibilities and the goals it owns. The founder edits names, roles, reporting lines, responsibilities
 * and goals, adds or removes members, then hires the team through the workforce service. When the AI could not propose
 * a team, the standard starter team is offered instead and labelled as such.
 */
export function WorkforceStage(p: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [mode, setMode] = useState(p.mode);
  const [team, setTeam] = useState<Member[]>(p.initial?.team ?? []);
  const [sel, setSel] = useState<string | null>(team[0]?.key ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [hired, setHired] = useState(p.hired);
  const [addRole, setAddRole] = useState("");
  const locked = mode === "approved" || !p.canHire || busy;
  const roleOf = (key: string) => p.roles.find((r) => r.key === key);
  const label = (k: string, vars?: Record<string, string | number>) => t(`onboarding.journey.workforce.${k}`, vars);

  const first = useRef(true);
  useEffect(() => {
    if (first.current || mode === "approved" || mode === "waiting" || !p.canHire) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => {
      setSaved("saving");
      api("/api/v1/me/onboarding", { method: "PATCH", body: { journeyStage: "workforce", draft: { workforce: { runId: p.runId, value: { team } } } } }).then(
        () => setSaved("saved"),
        () => setSaved("failed"),
      );
    }, 1200);
    return () => clearTimeout(id);
  }, [team, mode, p.runId, p.canHire]);

  const tree = useMemo(() => {
    const keys = new Set(team.map((m) => m.key));
    const roots = team.filter((m) => !m.reportsTo || !keys.has(m.reportsTo)).sort((a, b) => RANK[a.level] - RANK[b.level]);
    const ceo = roots.find((m) => m.level === "EXECUTIVE") ?? roots[0] ?? null;
    const reportsOf = (k: string) => team.filter((m) => m.reportsTo === k).sort((a, b) => RANK[a.level] - RANK[b.level] || a.name.localeCompare(b.name));
    const direct = ceo ? reportsOf(ceo.key) : [];
    const managers = direct.filter((m) => team.some((x) => x.reportsTo === m.key) || m.level !== "SPECIALIST");
    const loose = direct.filter((m) => !managers.includes(m));
    const others = roots.filter((m) => m !== ceo);
    return { ceo, managers: managers.map((m) => ({ m, reports: reportsOf(m.key) })), loose: [...loose, ...others] };
  }, [team]);

  const current = team.find((m) => m.key === sel) ?? null;
  const patch = (key: string, x: Partial<Member>) => setTeam((list) => list.map((m) => (m.key === key ? { ...m, ...x } : m)));
  const removeMember = (key: string) => {
    setTeam((list) => list.filter((m) => m.key !== key).map((m) => (m.reportsTo === key ? { ...m, reportsTo: list.find((x) => x.key === key)?.reportsTo ?? null } : m)));
    setSel(null);
  };
  const add = () => {
    const role = roleOf(addRole);
    if (!role) return;
    let key = role.key.slice(0, 34);
    for (let i = 2; team.some((m) => m.key === key); i++) key = `${role.key.slice(0, 34)}_${i}`;
    const ceo = team.find((m) => m.level === "EXECUTIVE");
    const manager = role.level === "SPECIALIST" ? team.find((m) => m.level === "MANAGER" && roleOf(m.profile)?.department === role.department) : null;
    setTeam((list) => [...list, { key, profile: role.key, name: `AI ${role.name}`.slice(0, 80), level: role.level, reportsTo: role.level === "EXECUTIVE" ? null : (manager?.key ?? ceo?.key ?? null), responsibilities: [], goals: [] }]);
    setSel(key);
    setAddRole("");
  };

  async function hire() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ aiEmployees: { created: number; skipped: number } }>(`${p.base}/workforce`, { body: { team: team.map((m) => ({ ...m, title: m.title?.trim() || undefined, name: m.name.trim() })) } });
      setHired(r.aiEmployees);
      setMode("approved");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (mode === "waiting") {
    return (
      <section className="grid justify-items-center gap-4 rounded-[1.75rem] border bg-surface/60 p-6 text-center shadow-elev-2 backdrop-blur sm:p-10">
        <AiCore className="size-28" />
        <h2 className="font-display text-2xl text-balance">{label("waiting.title")}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{p.stepStatus === "FAILED" ? label("waiting.failed", { error: p.stepError ?? "" }) : p.stepStatus === "RUNNING" ? label("waiting.running") : label("waiting.queued")}</p>
        {p.canHire && p.aiOk && p.stepStatus === "FAILED" && p.stepId ? <RetryStep base={p.base} stepId={p.stepId} /> : null}
        {p.canHire ? (
          <Button variant="secondary" onClick={() => setMode("starter")}>
            <Wand2 aria-hidden />
            {label("useStarter")}
          </Button>
        ) : null}
      </section>
    );
  }

  const levelLabel = (l: Level) => label(`levels.${l}`);
  return (
    <div className="grid gap-4">
      {mode === "starter" ? (
        <Notice tone="info" action={p.canHire && p.aiOk && p.stepStatus === "FAILED" && p.stepId ? <RetryStep base={p.base} stepId={p.stepId} /> : undefined}>
          {p.aiOk ? label("starterNotice") : label("starterNoAi")}
          {p.stepStatus === "FAILED" && p.stepError ? <span className="mt-1 block text-xs text-muted-foreground">{p.stepError}</span> : null}
        </Notice>
      ) : null}
      {mode === "proposal" ? <Notice tone="info">{label("proposalNotice")}</Notice> : null}
      {mode === "draft" ? <Notice tone="info">{label("draftNotice")}</Notice> : null}
      {!p.canHire ? <Notice tone="warning">{label("forbidden")}</Notice> : null}

      <section className="relative grid gap-5 overflow-hidden rounded-[1.75rem] border bg-surface/60 p-4 shadow-elev-2 backdrop-blur sm:p-6" aria-label={label("chart", { count: team.length })}>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(ellipse_at_top,var(--glow),transparent_70%)] opacity-40" />
        {tree.ceo ? (
          <div className="relative mx-auto w-full max-w-xs">
            <MemberCard m={tree.ceo} role={roleOf(tree.ceo.profile)} selected={sel === tree.ceo.key} onSelect={() => setSel(tree.ceo!.key)} levelLabel={levelLabel(tree.ceo.level)} />
            {tree.managers.length || tree.loose.length ? <span aria-hidden className="absolute start-1/2 -bottom-5 h-5 w-px bg-border-strong" /> : null}
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground">{label("empty")}</p>
        )}
        {tree.managers.length || tree.loose.length ? (
          <div className="relative grid gap-4 border-t border-border-strong/60 pt-5 sm:grid-cols-2 lg:grid-cols-3">
            {tree.managers.map(({ m, reports }) => (
              <div key={m.key} className="grid content-start gap-2">
                <MemberCard m={m} role={roleOf(m.profile)} selected={sel === m.key} onSelect={() => setSel(m.key)} levelLabel={levelLabel(m.level)} />
                {reports.length ? (
                  <ul className="ms-5 grid gap-2 border-s border-border-strong/60 ps-3">
                    {reports.map((r) => (
                      <li key={r.key}>
                        <MemberCard m={r} role={roleOf(r.profile)} selected={sel === r.key} onSelect={() => setSel(r.key)} levelLabel={levelLabel(r.level)} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
            {tree.loose.length ? (
              <div className="grid content-start gap-2">
                {tree.loose.map((m) => (
                  <MemberCard key={m.key} m={m} role={roleOf(m.profile)} selected={sel === m.key} onSelect={() => setSel(m.key)} levelLabel={levelLabel(m.level)} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {current ? (
        <section className="grid gap-3 rounded-2xl border bg-surface/90 p-4 shadow-elev-1" aria-label={label("editing", { name: current.name })}>
          <header className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <UserCog className="size-4 text-primary" aria-hidden />
              {current.name || "—"}
            </h2>
            {!locked ? (
              <Button size="sm" variant="ghost" onClick={() => removeMember(current.key)}>
                <Trash2 aria-hidden />
                {label("remove")}
              </Button>
            ) : null}
          </header>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={label("fields.name")} htmlFor="wf-name">
              <Input id="wf-name" value={current.name} disabled={locked} maxLength={80} onChange={(e) => patch(current.key, { name: e.target.value })} />
            </Field>
            <Field label={label("fields.title")} htmlFor="wf-title">
              <Input id="wf-title" value={current.title ?? ""} disabled={locked} maxLength={120} placeholder={roleOf(current.profile)?.name} onChange={(e) => patch(current.key, { title: e.target.value })} />
            </Field>
            <Field label={label("fields.role")} htmlFor="wf-role">
              <Select id="wf-role" value={current.profile} disabled={locked} onChange={(e) => patch(current.key, { profile: e.target.value })}>
                {!roleOf(current.profile) ? <option value={current.profile}>{current.profile}</option> : null}
                {p.roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={label("fields.level")} htmlFor="wf-level">
              <Select id="wf-level" value={current.level} disabled={locked} onChange={(e) => patch(current.key, { level: e.target.value as Level })}>
                {(["EXECUTIVE", "MANAGER", "SPECIALIST"] as const).map((l) => (
                  <option key={l} value={l}>
                    {levelLabel(l)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={label("fields.reportsTo")} htmlFor="wf-reports" className="sm:col-span-2">
              <Select id="wf-reports" value={current.reportsTo ?? ""} disabled={locked} onChange={(e) => patch(current.key, { reportsTo: e.target.value || null })}>
                <option value="">{label("fields.reportsToYou")}</option>
                {team
                  .filter((m) => m.key !== current.key)
                  .map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={label("fields.responsibilities")} htmlFor="wf-resp" hint={label("fields.onePerLine")} className="sm:col-span-2">
              <Textarea
                id="wf-resp"
                rows={3}
                disabled={locked}
                value={current.responsibilities.join("\n")}
                onChange={(e) => patch(current.key, { responsibilities: e.target.value.split("\n").map((x) => x.slice(0, 300)).slice(0, 10) })}
                onBlur={(e) => patch(current.key, { responsibilities: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 10) })}
              />
            </Field>
            <fieldset className="grid gap-1.5 sm:col-span-2">
              <legend className="text-[13px] font-medium">{label("fields.goals")}</legend>
              {p.goals.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {[...new Set([...p.goals, ...current.goals])].slice(0, 30).map((g) => {
                    const on = current.goals.includes(g);
                    return (
                      <button
                        key={g}
                        type="button"
                        disabled={locked}
                        aria-pressed={on}
                        onClick={() => patch(current.key, { goals: on ? current.goals.filter((x) => x !== g) : [...current.goals, g].slice(0, 10) })}
                        className={cn("max-w-full truncate rounded-full border px-2.5 py-1 text-xs", on ? "border-primary bg-accent text-accent-foreground" : "bg-surface hover:border-primary")}
                      >
                        {g}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{label("fields.noGoals")}</p>
              )}
            </fieldset>
          </div>
        </section>
      ) : null}

      {!locked ? (
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border bg-surface/80 p-3">
          <Field label={label("addRole")} htmlFor="wf-add" className="min-w-0 flex-1">
            <Select id="wf-add" value={addRole} onChange={(e) => setAddRole(e.target.value)}>
              <option value="">—</option>
              {p.roles.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="secondary" disabled={!addRole || team.length >= 15} onClick={add}>
            <Plus aria-hidden />
            {label("add")}
          </Button>
        </div>
      ) : null}

      {hired ? (
        <section className="flex items-center gap-3 rounded-2xl border border-success/40 bg-success/5 p-4">
          <SuccessBurst active size={56} label={label("hired", { created: hired.created, skipped: hired.skipped })} />
          <div>
            <h2 className="font-semibold">{label("hired", { created: hired.created, skipped: hired.skipped })}</h2>
            <p className="text-xs text-muted-foreground">{label("hiredHint")}</p>
          </div>
        </section>
      ) : null}

      <FormError error={error} />
      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-surface/90 p-3 shadow-elev-3 backdrop-blur">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {mode === "approved" ? label("hiredHint") : saved === "saving" ? t("onboarding.journey.saving") : saved === "saved" ? t("onboarding.journey.saved") : saved === "failed" ? t("onboarding.journey.saveFailed") : label("hireHint", { count: team.length })}
        </p>
        {mode === "approved" ? (
          <Button
            size="xl"
            variant="luminous"
            onClick={() => {
              router.push(`/${locale}/onboarding?stage=launch`);
              router.refresh();
            }}
          >
            {label("toLaunch")}
          </Button>
        ) : p.canHire ? (
          <Button size="xl" variant="luminous" magnetic loading={busy} disabled={team.some((m) => !m.name.trim())} onClick={hire}>
            {team.length ? label("hire", { count: team.length }) : label("skip")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
