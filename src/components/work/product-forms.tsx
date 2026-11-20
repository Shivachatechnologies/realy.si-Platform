"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAction } from "./actions";

const ITEM_STATUSES = ["PROPOSED", "PLANNED", "IN_PROGRESS", "SHIPPED", "CANCELLED"] as const;
const RELEASE_STATUSES = ["PLANNED", "IN_PROGRESS", "RELEASED"] as const;
const IMPACTS = ["0.25", "0.5", "1", "2", "3"] as const;

interface Opt {
  id: string;
  name: string;
}

function QuarterSelect({ id, value, onChange, quarters }: { id: string; value: string; onChange: (v: string) => void; quarters: string[] }) {
  const t = useT();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t("work.product.unscheduled")}</option>
      {quarters.map((q) => (
        <option key={q} value={q}>
          {q}
        </option>
      ))}
    </Select>
  );
}

export function InitiativeForm({ base, quarters }: { base: string; quarters: string[] }) {
  const t = useT();
  const empty = { title: "", description: "", quarter: quarters[0] ?? "", status: "PLANNED" };
  const [f, setF] = useState(empty);
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/product/initiatives`, { body: f }), () => setF(empty));
      }}
      className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_9rem_10rem_auto] sm:items-end"
    >
      <Field label={t("work.product.initiative")} htmlFor="in-title">
        <Input id="in-title" value={f.title} maxLength={200} required onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))} />
      </Field>
      <Field label={t("work.product.quarter")} htmlFor="in-q">
        <QuarterSelect id="in-q" value={f.quarter} quarters={quarters} onChange={(v) => setF((p) => ({ ...p, quarter: v }))} />
      </Field>
      <Field label={t("work.task.status")} htmlFor="in-status">
        <Select id="in-status" value={f.status} onChange={(e) => setF((p) => ({ ...p, status: e.target.value }))}>
          {ITEM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`work.itemStatus.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" variant="secondary" disabled={busy || !f.title.trim()}>
        <Plus aria-hidden />
        {t("work.product.addInitiative")}
      </Button>
      <Field label={t("work.product.description")} htmlFor="in-desc" className="sm:col-span-4">
        <Input id="in-desc" value={f.description} maxLength={5000} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} />
      </Field>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export interface FeatureValues {
  title: string;
  spec: string;
  status: string;
  quarter: string;
  initiativeId: string;
  projectId: string;
  releaseId: string;
  reach: string;
  impact: string;
  confidence: string;
  effort: string;
}

const featurePayload = (f: FeatureValues) => ({
  ...f,
  reach: f.reach === "" ? null : Number(f.reach),
  impact: f.impact === "" ? null : Number(f.impact),
  confidence: f.confidence === "" ? null : Number(f.confidence),
  effort: f.effort === "" ? null : Number(f.effort),
});

/** RICE preview, same formula as the server. */
export function rice(f: Pick<FeatureValues, "reach" | "impact" | "confidence" | "effort">) {
  if ([f.reach, f.impact, f.confidence, f.effort].some((v) => v === "") || Number(f.effort) <= 0) return null;
  return Math.round(((Number(f.reach) * Number(f.impact) * (Number(f.confidence) / 100)) / Number(f.effort)) * 10) / 10;
}

export function FeatureForm({
  base,
  locale,
  featureId,
  initial,
  quarters,
  initiatives,
  projects,
  releases,
}: {
  base: string;
  locale: string;
  featureId?: string;
  initial?: FeatureValues;
  quarters: string[];
  initiatives: Opt[];
  projects: Opt[];
  releases: Opt[];
}) {
  const t = useT();
  const router = useRouter();
  const empty: FeatureValues = { title: "", spec: "", status: "PROPOSED", quarter: "", initiativeId: "", projectId: "", releaseId: "", reach: "", impact: "", confidence: "", effort: "" };
  const [f, setF] = useState<FeatureValues>(initial ?? empty);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const set = (k: keyof FeatureValues) => (e: { target: { value: string } }) => (setSaved(false), setF((p) => ({ ...p, [k]: e.target.value })));
  const score = rice(f);
  const opt = (id: string, label: string, k: keyof FeatureValues, items: Opt[]) => (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={f[k]} onChange={set(k)}>
        <option value="">{t("work.none")}</option>
        {items.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(
          () => (featureId ? api(`${base}/product/features/${featureId}`, { method: "PATCH", body: featurePayload(f) }) : api<{ id: string }>(`${base}/product/features`, { body: featurePayload(f) })),
          (r) => (featureId ? setSaved(true) : router.push(`/${locale}/product/features/${(r as { id: string }).id}`)),
        );
      }}
      className="grid gap-3 sm:grid-cols-4"
    >
      <Field label={t("work.product.featureTitle")} htmlFor="ft-title" className="sm:col-span-2">
        <Input id="ft-title" value={f.title} maxLength={200} required onChange={set("title")} />
      </Field>
      <Field label={t("work.task.status")} htmlFor="ft-status">
        <Select id="ft-status" value={f.status} onChange={set("status")}>
          {ITEM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`work.itemStatus.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.product.quarter")} htmlFor="ft-q">
        <QuarterSelect id="ft-q" value={f.quarter} quarters={quarters} onChange={(v) => (setSaved(false), setF((p) => ({ ...p, quarter: v })))} />
      </Field>
      {opt("ft-init", t("work.product.initiative"), "initiativeId", initiatives)}
      {opt("ft-project", t("work.task.project"), "projectId", projects)}
      {opt("ft-release", t("work.product.release"), "releaseId", releases)}
      <div />
      <fieldset className="grid gap-2 rounded-md border p-3 sm:col-span-4 sm:grid-cols-5 sm:items-end">
        <legend className="px-1 text-xs font-medium text-muted-foreground">{t("work.product.rice")}</legend>
        <Field label={t("work.product.reach")} htmlFor="ft-reach" hint={t("work.product.reachHint")}>
          <Input id="ft-reach" type="number" min={0} value={f.reach} onChange={set("reach")} />
        </Field>
        <Field label={t("work.product.impact")} htmlFor="ft-impact">
          <Select id="ft-impact" value={f.impact} onChange={set("impact")}>
            <option value="">—</option>
            {IMPACTS.map((v) => (
              <option key={v} value={v}>
                {v} · {t(`work.product.impacts.${v.replace(".", "_")}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("work.product.confidence")} htmlFor="ft-conf" hint="%">
          <Input id="ft-conf" type="number" min={0} max={100} value={f.confidence} onChange={set("confidence")} />
        </Field>
        <Field label={t("work.product.effort")} htmlFor="ft-effort" hint={t("work.product.effortHint")}>
          <Input id="ft-effort" type="number" min={0.1} step={0.1} value={f.effort} onChange={set("effort")} />
        </Field>
        <div className="grid gap-0.5">
          <span className="text-xs text-muted-foreground">{t("work.product.riceScore")}</span>
          <span className="text-xl font-semibold tabular-nums">{score ?? "—"}</span>
        </div>
      </fieldset>
      <Field label={t("work.product.spec")} htmlFor="ft-spec" className="sm:col-span-4" hint={t("work.product.specHint")}>
        <Textarea id="ft-spec" rows={featureId ? 10 : 4} value={f.spec} maxLength={50000} onChange={set("spec")} />
      </Field>
      <div className="flex items-center gap-2 sm:col-span-4">
        <Button type="submit" variant={featureId ? "secondary" : "default"} disabled={busy || !f.title.trim()}>
          {featureId ? (
            t("common.save")
          ) : (
            <>
              <Plus aria-hidden />
              {t("work.product.addFeature")}
            </>
          )}
        </Button>
        {saved ? <span className="text-xs text-success">{t("work.saved")}</span> : null}
      </div>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function IdeaForm({ base }: { base: string }) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/product/ideas`, { body: { title, description } }), () => (setTitle(""), setDescription("")));
      }}
      className="grid gap-2 p-3"
    >
      <Field label={t("work.product.ideaTitle")} htmlFor="id-title">
        <Input id="id-title" value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={t("work.product.description")} htmlFor="id-desc">
        <Textarea id="id-desc" rows={2} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" disabled={busy || !title.trim()}>
          <Plus aria-hidden />
          {t("work.product.submitIdea")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

export function VoteButton({ base, ideaId, voted, count }: { base: string; ideaId: string; voted: boolean; count: number }) {
  const t = useT();
  const { busy, error, run } = useAction();
  return (
    <span className="inline-grid gap-1">
      <button
        type="button"
        disabled={busy}
        aria-pressed={voted}
        aria-label={voted ? t("work.product.unvote") : t("work.product.vote")}
        onClick={() => void run(() => api(`${base}/product/ideas/${ideaId}/vote`, { body: {} }))}
        className={cn("flex w-14 flex-col items-center rounded-md border px-2 py-1 text-xs", voted ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
      >
        <ThumbsUp className="size-4" aria-hidden />
        <span className="font-semibold tabular-nums">{count}</span>
      </button>
      <FormError error={error} />
    </span>
  );
}

export function FeedbackForm({ base, accounts, contacts, features, sources }: { base: string; accounts: Opt[]; contacts: (Opt & { accountId: string | null })[]; features: Opt[]; sources: string[] }) {
  const t = useT();
  const empty = { source: "email", body: "", accountId: "", contactId: "", featureId: "" };
  const [f, setF] = useState(empty);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value, ...(k === "accountId" ? { contactId: "" } : {}) }));
  const visibleContacts = f.accountId ? contacts.filter((c) => c.accountId === f.accountId) : contacts;
  const allSources = [...new Set(["email", "call", "meeting", "support", "survey", "sales", ...sources])];
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/product/feedback`, { body: f }), () => setF(empty));
      }}
      className="grid gap-2 p-3 sm:grid-cols-4"
    >
      <Field label={t("work.product.source")} htmlFor="fb-source">
        <Input id="fb-source" list="fb-sources" value={f.source} maxLength={60} required onChange={set("source")} />
        <datalist id="fb-sources">
          {allSources.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>
      <Field label={t("work.product.account")} htmlFor="fb-account">
        <Select id="fb-account" value={f.accountId} onChange={set("accountId")}>
          <option value="">{t("work.none")}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.product.contact")} htmlFor="fb-contact">
        <Select id="fb-contact" value={f.contactId} onChange={set("contactId")}>
          <option value="">{t("work.none")}</option>
          {visibleContacts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.product.feature")} htmlFor="fb-feature">
        <Select id="fb-feature" value={f.featureId} onChange={set("featureId")}>
          <option value="">{t("work.none")}</option>
          {features.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.product.feedbackBody")} htmlFor="fb-body" className="sm:col-span-4">
        <Textarea id="fb-body" rows={3} value={f.body} maxLength={10000} required onChange={set("body")} />
      </Field>
      <div className="sm:col-span-4">
        <Button type="submit" disabled={busy || !f.body.trim() || !f.source.trim()}>
          <Plus aria-hidden />
          {t("work.product.addFeedback")}
        </Button>
      </div>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export interface ReleaseValues {
  version: string;
  name: string;
  releaseDate: string;
  status: string;
  notes: string;
  featureIds: string[];
}

export function ReleaseForm({ base, releaseId, initial, features, published, onDone }: { base: string; releaseId?: string; initial?: ReleaseValues; features: Opt[]; published?: boolean; onDone?: () => void }) {
  const t = useT();
  const empty: ReleaseValues = { version: "", name: "", releaseDate: "", status: "PLANNED", notes: "", featureIds: [] };
  const [f, setF] = useState<ReleaseValues>(initial ?? empty);
  const { busy, error, run } = useAction();
  const set = (k: keyof Omit<ReleaseValues, "featureIds">) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const id = releaseId ?? "new";
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => (releaseId ? api(`${base}/product/releases/${releaseId}`, { method: "PATCH", body: f }) : api(`${base}/product/releases`, { body: f })), () => (releaseId ? onDone?.() : setF(empty)));
      }}
      className="grid gap-2 p-3 sm:grid-cols-4"
    >
      <Field label={t("work.product.version")} htmlFor={`rl-v-${id}`} hint={t("work.product.versionHint")}>
        <Input id={`rl-v-${id}`} value={f.version} maxLength={40} required onChange={set("version")} />
      </Field>
      <Field label={t("work.product.releaseName")} htmlFor={`rl-n-${id}`}>
        <Input id={`rl-n-${id}`} value={f.name} maxLength={200} onChange={set("name")} />
      </Field>
      <Field label={t("work.product.releaseDate")} htmlFor={`rl-d-${id}`}>
        <Input id={`rl-d-${id}`} type="date" value={f.releaseDate} onChange={set("releaseDate")} />
      </Field>
      <Field label={t("work.task.status")} htmlFor={`rl-s-${id}`}>
        <Select id={`rl-s-${id}`} value={f.status} onChange={set("status")} disabled={published}>
          {RELEASE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`work.releaseStatus.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.product.includedFeatures")} htmlFor={`rl-f-${id}`} hint={t("work.project.membersHint")} className="sm:col-span-4">
        <select
          id={`rl-f-${id}`}
          multiple
          className="min-h-24 w-full rounded-md border border-input bg-surface px-2 py-1 text-sm"
          value={f.featureIds}
          onChange={(e) => setF((p) => ({ ...p, featureIds: [...e.target.selectedOptions].map((o) => o.value) }))}
        >
          {features.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("work.product.notes")} htmlFor={`rl-notes-${id}`} hint={t("work.product.notesHint")} className="sm:col-span-4">
        <Textarea id={`rl-notes-${id}`} rows={4} value={f.notes} maxLength={20000} onChange={set("notes")} />
      </Field>
      <div className="flex gap-2 sm:col-span-4">
        <Button type="submit" variant="secondary" disabled={busy || !f.version.trim()}>
          {releaseId ? t("common.save") : t("work.product.addRelease")}
        </Button>
        {onDone ? (
          <Button type="button" variant="ghost" onClick={onDone}>
            {t("common.cancel")}
          </Button>
        ) : null}
      </div>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function ReleaseEditor({ base, releaseId, initial, features, published }: { base: string; releaseId: string; initial: ReleaseValues; features: Opt[]; published: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (open) return <div className="rounded-md border"><ReleaseForm base={base} releaseId={releaseId} initial={initial} features={features} published={published} onDone={() => setOpen(false)} /></div>;
  return (
    <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
      {t("work.edit")}
    </Button>
  );
}
