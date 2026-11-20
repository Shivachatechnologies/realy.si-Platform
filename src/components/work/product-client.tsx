"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { PersonSelect, useAction, type Person } from "./actions";

interface Opt {
  id: string;
  name: string;
}

const PRODUCT_STATUSES = ["ACTIVE", "ON_HOLD", "SUNSET"] as const;
const VALIDATION_KINDS = ["INTERVIEW", "SURVEY", "EXPERIMENT", "MARKET_DATA", "PREORDER", "OTHER"] as const;
const VALIDATION_RESULTS = ["PENDING", "VALIDATED", "INVALIDATED", "INCONCLUSIVE"] as const;
const DOC_STATUSES = ["DRAFT", "IN_REVIEW", "APPROVED"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

/** Product select that navigates to `path?product=<id>`. */
export function ProductFilter({ path, products, value, label, allLabel }: { path: string; products: Opt[]; value?: string; label: string; allLabel: string }) {
  const router = useRouter();
  return (
    <Select aria-label={label} className="h-8 w-auto text-xs" value={value ?? ""} onChange={(e) => router.push(e.target.value ? `${path}?product=${e.target.value}` : path)}>
      <option value="">{allLabel}</option>
      {products.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}

// ─── Product create / edit ───

export interface ProductValues {
  name: string;
  description: string;
  targetUsers: string;
  status: string;
  ownerId: string;
  graphEntityId: string;
  developmentProjectId: string;
}

export function ProductForm({
  base,
  locale,
  productId,
  initial,
  people,
  entities,
  projects,
  onDone,
}: {
  base: string;
  locale: string;
  productId?: string;
  initial?: ProductValues;
  people: Person[];
  entities: Opt[];
  projects: Opt[];
  onDone?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const empty: ProductValues = { name: "", description: "", targetUsers: "", status: "ACTIVE", ownerId: "", graphEntityId: "", developmentProjectId: "" };
  const [f, setF] = useState<ProductValues>(initial ?? empty);
  const [createGraphEntity, setCreateGraphEntity] = useState(true);
  const [createProject, setCreateProject] = useState(true);
  const { busy, error, run } = useAction();
  const set = (k: keyof ProductValues) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const id = productId ?? "new";
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(
          () =>
            productId
              ? api(`${base}/product/products/${productId}`, { method: "PATCH", body: f })
              : api<{ id: string }>(`${base}/product/products`, { body: { ...f, createGraphEntity: !f.graphEntityId && createGraphEntity, createProject: !f.developmentProjectId && createProject } }),
          (r) => (productId ? onDone?.() : router.push(`/${locale}/product/${(r as { id: string }).id}`)),
        );
      }}
      className="grid gap-3 sm:grid-cols-3"
    >
      <Field label={t("product.fields.name")} htmlFor={`pr-name-${id}`}>
        <Input id={`pr-name-${id}`} value={f.name} maxLength={120} required onChange={set("name")} />
      </Field>
      <Field label={t("product.fields.owner")} htmlFor={`pr-owner-${id}`} hint={t("product.fields.ownerHint")}>
        <PersonSelect id={`pr-owner-${id}`} people={people} value={f.ownerId} onChange={(v) => setF((p) => ({ ...p, ownerId: v }))} emptyLabel={productId ? t("work.none") : t("product.fields.ownerMe")} />
      </Field>
      <Field label={t("work.task.status")} htmlFor={`pr-status-${id}`}>
        <Select id={`pr-status-${id}`} value={f.status} onChange={set("status")}>
          {PRODUCT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`product.status.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.product.description")} htmlFor={`pr-desc-${id}`} className="sm:col-span-3">
        <Textarea id={`pr-desc-${id}`} rows={3} value={f.description} maxLength={5000} onChange={set("description")} />
      </Field>
      <Field label={t("product.fields.targetUsers")} htmlFor={`pr-users-${id}`} className="sm:col-span-3" hint={t("product.fields.targetUsersHint")}>
        <Textarea id={`pr-users-${id}`} rows={2} value={f.targetUsers} maxLength={2000} onChange={set("targetUsers")} />
      </Field>
      <Field label={t("product.fields.graphEntity")} htmlFor={`pr-graph-${id}`}>
        <Select id={`pr-graph-${id}`} value={f.graphEntityId} onChange={set("graphEntityId")}>
          <option value="">{t("work.none")}</option>
          {entities.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("product.fields.project")} htmlFor={`pr-project-${id}`}>
        <Select id={`pr-project-${id}`} value={f.developmentProjectId} onChange={set("developmentProjectId")}>
          <option value="">{t("work.none")}</option>
          {projects.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </Field>
      {!productId ? (
        <div className="grid content-end gap-1 text-sm">
          {!f.graphEntityId ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={createGraphEntity} onChange={(e) => setCreateGraphEntity(e.target.checked)} />
              {t("product.fields.createGraphEntity")}
            </label>
          ) : null}
          {!f.developmentProjectId ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={createProject} onChange={(e) => setCreateProject(e.target.checked)} />
              {t("product.fields.createProject")}
            </label>
          ) : null}
        </div>
      ) : null}
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" disabled={busy || !f.name.trim()}>
          {productId ? t("common.save") : (
            <>
              <Plus aria-hidden />
              {t("product.create")}
            </>
          )}
        </Button>
        {onDone ? (
          <Button type="button" variant="ghost" onClick={onDone}>
            {t("common.cancel")}
          </Button>
        ) : null}
      </div>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function ProductEditor(props: Omit<Parameters<typeof ProductForm>[0], "onDone">) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (open) return <ProductForm {...props} onDone={() => setOpen(false)} />;
  return (
    <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
      {t("work.edit")}
    </Button>
  );
}

// ─── Stage gate ───

export interface GateItemView {
  id: string;
  label: string;
  done: boolean;
  custom: boolean;
}

export function GateChecklist({ base, productId, items, canEdit }: { base: string; productId: string; items: GateItemView[]; canEdit: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [label, setLabel] = useState("");
  const url = `${base}/product/products/${productId}/gate`;
  return (
    <div className="grid gap-2">
      <ul className="grid gap-1 text-sm">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              id={`gate-${i.id}`}
              checked={i.done}
              disabled={!canEdit || busy}
              onChange={(e) => void run(() => api(url, { method: "PATCH", body: { itemId: i.id, done: e.target.checked } }))}
            />
            <label htmlFor={`gate-${i.id}`} className={cn("min-w-0 flex-1", i.done && "text-muted-foreground line-through")}>
              {i.label}
            </label>
            {canEdit && i.custom ? (
              <button type="button" className="text-muted-foreground hover:text-danger" aria-label={t("work.delete")} disabled={busy} onClick={() => void run(() => api(url, { method: "PATCH", body: { removeItemId: i.id } }))}>
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api(url, { body: { label } }), () => setLabel(""));
          }}
        >
          <Input aria-label={t("product.gate.addItem")} placeholder={t("product.gate.addItem")} value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} className="h-8 text-sm" />
          <Button type="submit" size="sm" variant="secondary" disabled={busy || !label.trim()}>
            <Plus aria-hidden />
          </Button>
        </form>
      ) : null}
      <FormError error={error} />
    </div>
  );
}

/** Move to the next stage (with a note) or back to an earlier one. */
export function StageMover({ base, productId, canAdvance, nextLabel, earlier }: { base: string; productId: string; canAdvance: boolean; nextLabel: string | null; earlier: { value: string; label: string }[] }) {
  const t = useT();
  const [note, setNote] = useState("");
  const [back, setBack] = useState("");
  const { busy, error, run } = useAction();
  const url = `${base}/product/products/${productId}/stage`;
  return (
    <div className="grid gap-2">
      {nextLabel ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label={t("product.gate.note")} placeholder={t("product.gate.note")} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} className="h-8 min-w-40 flex-1 text-sm" />
          <Button type="button" size="sm" disabled={busy || !canAdvance} title={canAdvance ? undefined : t("product.gate.approveFirst")} onClick={() => void run(() => api(url, { body: { note } }), () => setNote(""))}>
            {t("product.gate.advance", { stage: nextLabel })}
          </Button>
        </div>
      ) : null}
      {earlier.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label={t("product.gate.moveBack")} className="h-8 w-auto text-xs" value={back} onChange={(e) => setBack(e.target.value)}>
            <option value="">{t("product.gate.moveBack")}</option>
            {earlier.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Button type="button" size="sm" variant="ghost" disabled={busy || !back} onClick={() => void run(() => api(url, { body: { toStage: back, note } }), () => setBack(""))}>
            {t("product.gate.moveBackButton")}
          </Button>
        </div>
      ) : null}
      <FormError error={error} />
    </div>
  );
}

// ─── Research ───

export interface CompetitorValues {
  name: string;
  website: string;
  strengths: string;
  weaknesses: string;
  notes: string;
  links: string;
}

export function CompetitorForm({ base, productId, competitorId, initial, onDone }: { base: string; productId: string; competitorId?: string; initial?: CompetitorValues; onDone?: () => void }) {
  const t = useT();
  const empty: CompetitorValues = { name: "", website: "", strengths: "", weaknesses: "", notes: "", links: "" };
  const [f, setF] = useState<CompetitorValues>(initial ?? empty);
  const { busy, error, run } = useAction();
  const set = (k: keyof CompetitorValues) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const id = competitorId ?? "new";
  const payload = { ...f, links: f.links.split(/\s+/).map((s) => s.trim()).filter(Boolean) };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => (competitorId ? api(`${base}/product/competitors/${competitorId}`, { method: "PATCH", body: payload }) : api(`${base}/product/products/${productId}/competitors`, { body: payload })), () => (competitorId ? onDone?.() : setF(empty)));
      }}
      className="grid gap-2 p-3 sm:grid-cols-2"
    >
      <Field label={t("product.research.competitor")} htmlFor={`cp-name-${id}`}>
        <Input id={`cp-name-${id}`} value={f.name} maxLength={120} required onChange={set("name")} />
      </Field>
      <Field label={t("product.research.website")} htmlFor={`cp-web-${id}`}>
        <Input id={`cp-web-${id}`} type="url" placeholder="https://" value={f.website} maxLength={500} onChange={set("website")} />
      </Field>
      <Field label={t("product.research.strengths")} htmlFor={`cp-str-${id}`}>
        <Textarea id={`cp-str-${id}`} rows={2} value={f.strengths} maxLength={5000} onChange={set("strengths")} />
      </Field>
      <Field label={t("product.research.weaknesses")} htmlFor={`cp-weak-${id}`}>
        <Textarea id={`cp-weak-${id}`} rows={2} value={f.weaknesses} maxLength={5000} onChange={set("weaknesses")} />
      </Field>
      <Field label={t("product.research.notes")} htmlFor={`cp-notes-${id}`}>
        <Textarea id={`cp-notes-${id}`} rows={2} value={f.notes} maxLength={10000} onChange={set("notes")} />
      </Field>
      <Field label={t("product.research.links")} htmlFor={`cp-links-${id}`} hint={t("product.research.linksHint")}>
        <Textarea id={`cp-links-${id}`} rows={2} value={f.links} onChange={set("links")} />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={busy || !f.name.trim()}>
          {competitorId ? t("common.save") : t("product.research.addCompetitor")}
        </Button>
        {onDone ? (
          <Button type="button" variant="ghost" onClick={onDone}>
            {t("common.cancel")}
          </Button>
        ) : null}
      </div>
      <div className="sm:col-span-2">
        <FormError error={error} />
      </div>
    </form>
  );
}

export interface ValidationValues {
  kind: string;
  hypothesis: string;
  evidence: string;
  result: string;
  sampleSize: string;
  sourceUrl: string;
}

export function ValidationForm({ base, productId, validationId, initial, onDone }: { base: string; productId: string; validationId?: string; initial?: ValidationValues; onDone?: () => void }) {
  const t = useT();
  const empty: ValidationValues = { kind: "INTERVIEW", hypothesis: "", evidence: "", result: "PENDING", sampleSize: "", sourceUrl: "" };
  const [f, setF] = useState<ValidationValues>(initial ?? empty);
  const { busy, error, run } = useAction();
  const set = (k: keyof ValidationValues) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const id = validationId ?? "new";
  const payload = { ...f, sampleSize: f.sampleSize === "" ? null : Number(f.sampleSize) };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => (validationId ? api(`${base}/product/validations/${validationId}`, { method: "PATCH", body: payload }) : api(`${base}/product/products/${productId}/validations`, { body: payload })), () => (validationId ? onDone?.() : setF(empty)));
      }}
      className="grid gap-2 p-3 sm:grid-cols-4"
    >
      <Field label={t("product.research.hypothesis")} htmlFor={`vl-h-${id}`} className="sm:col-span-4">
        <Input id={`vl-h-${id}`} value={f.hypothesis} maxLength={1000} required onChange={set("hypothesis")} />
      </Field>
      <Field label={t("product.research.kind")} htmlFor={`vl-k-${id}`}>
        <Select id={`vl-k-${id}`} value={f.kind} onChange={set("kind")}>
          {VALIDATION_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`product.validationKind.${k}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("product.research.result")} htmlFor={`vl-r-${id}`}>
        <Select id={`vl-r-${id}`} value={f.result} onChange={set("result")}>
          {VALIDATION_RESULTS.map((k) => (
            <option key={k} value={k}>
              {t(`product.validationResult.${k}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("product.research.sampleSize")} htmlFor={`vl-n-${id}`}>
        <Input id={`vl-n-${id}`} type="number" min={0} value={f.sampleSize} onChange={set("sampleSize")} />
      </Field>
      <Field label={t("product.research.source")} htmlFor={`vl-u-${id}`}>
        <Input id={`vl-u-${id}`} type="url" placeholder="https://" value={f.sourceUrl} maxLength={500} onChange={set("sourceUrl")} />
      </Field>
      <Field label={t("product.research.evidence")} htmlFor={`vl-e-${id}`} className="sm:col-span-4">
        <Textarea id={`vl-e-${id}`} rows={3} value={f.evidence} maxLength={10000} onChange={set("evidence")} />
      </Field>
      <div className="flex gap-2 sm:col-span-4">
        <Button type="submit" variant="secondary" disabled={busy || !f.hypothesis.trim()}>
          {validationId ? t("common.save") : t("product.research.addValidation")}
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

export interface PersonaValues {
  name: string;
  role: string;
  description: string;
  goals: string;
  painPoints: string;
}

export function PersonaForm({ base, productId, personaId, initial, onDone }: { base: string; productId: string; personaId?: string; initial?: PersonaValues; onDone?: () => void }) {
  const t = useT();
  const empty: PersonaValues = { name: "", role: "", description: "", goals: "", painPoints: "" };
  const [f, setF] = useState<PersonaValues>(initial ?? empty);
  const { busy, error, run } = useAction();
  const set = (k: keyof PersonaValues) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const id = personaId ?? "new";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => (personaId ? api(`${base}/product/personas/${personaId}`, { method: "PATCH", body: f }) : api(`${base}/product/products/${productId}/personas`, { body: f })), () => (personaId ? onDone?.() : setF(empty)));
      }}
      className="grid gap-2 p-3 sm:grid-cols-2"
    >
      <Field label={t("product.research.personaName")} htmlFor={`ps-n-${id}`}>
        <Input id={`ps-n-${id}`} value={f.name} maxLength={120} required onChange={set("name")} />
      </Field>
      <Field label={t("product.research.role")} htmlFor={`ps-r-${id}`}>
        <Input id={`ps-r-${id}`} value={f.role} maxLength={200} onChange={set("role")} />
      </Field>
      <Field label={t("work.product.description")} htmlFor={`ps-d-${id}`} className="sm:col-span-2">
        <Textarea id={`ps-d-${id}`} rows={2} value={f.description} maxLength={5000} onChange={set("description")} />
      </Field>
      <Field label={t("product.research.goals")} htmlFor={`ps-g-${id}`}>
        <Textarea id={`ps-g-${id}`} rows={2} value={f.goals} maxLength={5000} onChange={set("goals")} />
      </Field>
      <Field label={t("product.research.painPoints")} htmlFor={`ps-p-${id}`}>
        <Textarea id={`ps-p-${id}`} rows={2} value={f.painPoints} maxLength={5000} onChange={set("painPoints")} />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={busy || !f.name.trim()}>
          {personaId ? t("common.save") : t("product.research.addPersona")}
        </Button>
        {onDone ? (
          <Button type="button" variant="ghost" onClick={onDone}>
            {t("common.cancel")}
          </Button>
        ) : null}
      </div>
      <div className="sm:col-span-2">
        <FormError error={error} />
      </div>
    </form>
  );
}

/** Edit toggle around one of the research forms. */
export function InlineEdit({ kind, base, productId, id, initial }: { kind: "competitor" | "validation" | "persona"; base: string; productId: string; id: string; initial: CompetitorValues | ValidationValues | PersonaValues }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {t("work.edit")}
      </Button>
    );
  const done = () => setOpen(false);
  return (
    <div className="basis-full rounded-md border">
      {kind === "competitor" ? <CompetitorForm base={base} productId={productId} competitorId={id} initial={initial as CompetitorValues} onDone={done} /> : null}
      {kind === "validation" ? <ValidationForm base={base} productId={productId} validationId={id} initial={initial as ValidationValues} onDone={done} /> : null}
      {kind === "persona" ? <PersonaForm base={base} productId={productId} personaId={id} initial={initial as PersonaValues} onDone={done} /> : null}
    </div>
  );
}

// ─── Documents ───

export function DocEditor({ url, initial, canEdit, disabledHint }: { url: string; initial: string; canEdit: boolean; disabledHint?: string }) {
  const t = useT();
  const [content, setContent] = useState(initial);
  const [changeNote, setChangeNote] = useState("");
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(url, { body: { content, changeNote } }), () => (setSaved(true), setChangeNote("")));
      }}
    >
      <Textarea
        aria-label={t("product.docs.content")}
        rows={24}
        className="font-mono text-[13px]"
        value={content}
        maxLength={200000}
        readOnly={!canEdit}
        onChange={(e) => (setSaved(false), setContent(e.target.value))}
        placeholder={t("product.docs.placeholder")}
      />
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label={t("product.docs.changeNote")} placeholder={t("product.docs.changeNote")} value={changeNote} maxLength={300} onChange={(e) => setChangeNote(e.target.value)} className="h-9 min-w-48 flex-1" />
          <Button type="submit" disabled={busy || !content.trim() || content === initial}>
            {t("product.docs.saveVersion")}
          </Button>
          {saved ? <span className="text-xs text-success">{t("work.saved")}</span> : null}
        </div>
      ) : disabledHint ? (
        <p className="text-xs text-muted-foreground">{disabledHint}</p>
      ) : null}
      <FormError error={error} />
    </form>
  );
}

export function DocStatusSelect({ url, value }: { url: string; value: string }) {
  const t = useT();
  const { busy, error, run } = useAction();
  return (
    <span className="inline-grid gap-1">
      <Select aria-label={t("work.task.status")} className="h-8 w-auto text-xs" value={value} disabled={busy} onChange={(e) => void run(() => api(url, { method: "PATCH", body: { status: e.target.value } }))}>
        {DOC_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`product.docStatus.${s}`)}
          </option>
        ))}
      </Select>
      <FormError error={error} />
    </span>
  );
}

/** "Generate with AI" with optional guidance. */
export function GenerateAi({ url, label, placeholder }: { url: string; label: string; placeholder: string }) {
  const [guidance, setGuidance] = useState("");
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-2">
      <Textarea aria-label={placeholder} placeholder={placeholder} rows={2} value={guidance} maxLength={2000} onChange={(e) => setGuidance(e.target.value)} />
      <div>
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => api(url, { body: { guidance } }), () => setGuidance(""))}>
          <Sparkles aria-hidden />
          {label}
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}

// ─── Backlog ───

export function BacklogForm({ base, productId, features, sprints }: { base: string; productId: string; features: Opt[]; sprints: Opt[] }) {
  const t = useT();
  const [titles, setTitles] = useState("");
  const [featureId, setFeatureId] = useState("");
  const [sprintId, setSprintId] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [points, setPoints] = useState("");
  const { busy, error, run } = useAction();
  const lines = titles.split("\n").map((s) => s.trim()).filter(Boolean);
  return (
    <form
      className="grid gap-2 p-3 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () =>
            api(`${base}/product/products/${productId}/backlog`, {
              body: { featureId: featureId || null, sprintId: sprintId || null, tasks: lines.map((title) => ({ title, priority, estimatePoints: points === "" ? null : Number(points) })) },
            }),
          () => setTitles(""),
        );
      }}
    >
      <Field label={t("product.backlog.titles")} htmlFor="bl-titles" hint={t("product.backlog.titlesHint")} className="sm:col-span-4">
        <Textarea id="bl-titles" rows={4} value={titles} onChange={(e) => setTitles(e.target.value)} />
      </Field>
      <Field label={t("work.product.feature")} htmlFor="bl-feature">
        <Select id="bl-feature" value={featureId} onChange={(e) => setFeatureId(e.target.value)}>
          <option value="">{t("work.none")}</option>
          {features.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("product.backlog.sprint")} htmlFor="bl-sprint">
        <Select id="bl-sprint" value={sprintId} onChange={(e) => setSprintId(e.target.value)}>
          <option value="">{t("product.backlog.noSprint")}</option>
          {sprints.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.task.priority")} htmlFor="bl-priority">
        <Select id="bl-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`work.priority.${p}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("product.backlog.points")} htmlFor="bl-points">
        <Input id="bl-points" type="number" min={0} max={100} value={points} onChange={(e) => setPoints(e.target.value)} />
      </Field>
      <div className="sm:col-span-4">
        <Button type="submit" disabled={busy || !lines.length || lines.length > 50}>
          <Plus aria-hidden />
          {t("product.backlog.create", { count: lines.length })}
        </Button>
      </div>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function PushToSprint({ base, productId, featureId, sprints }: { base: string; productId: string; featureId: string; sprints: Opt[] }) {
  const t = useT();
  const [sprintId, setSprintId] = useState(sprints[0]?.id ?? "");
  const { busy, error, run } = useAction();
  if (!sprints.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Select aria-label={t("product.backlog.sprint")} className="h-8 w-auto text-xs" value={sprintId} onChange={(e) => setSprintId(e.target.value)}>
        {sprints.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
      <Button type="button" size="sm" variant="secondary" disabled={busy || !sprintId} onClick={() => void run(() => api(`${base}/product/products/${productId}/backlog/sprint`, { body: { featureId, sprintId } }))}>
        {t("product.backlog.toSprint")}
      </Button>
      <FormError error={error} />
    </span>
  );
}

// ─── AI product team ───

export function PlanStarter({ base, productId, disabled }: { base: string; productId: string; disabled?: boolean }) {
  const t = useT();
  const [brief, setBrief] = useState("");
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-2">
      <Textarea aria-label={t("product.plan.brief")} placeholder={t("product.plan.briefPlaceholder")} rows={3} value={brief} maxLength={2000} onChange={(e) => setBrief(e.target.value)} />
      <div>
        <Button type="button" disabled={busy || disabled} onClick={() => void run(() => api(`${base}/product/products/${productId}/plan`, { body: { brief } }), () => setBrief(""))}>
          <Sparkles aria-hidden />
          {t("product.plan.start")}
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}

export function HireTeam({ base, profiles }: { base: string; profiles: { key: string; label: string; hired: boolean }[] }) {
  const t = useT();
  const [picked, setPicked] = useState<string[]>(profiles.filter((p) => !p.hired).map((p) => p.key));
  const [result, setResult] = useState<number | null>(null);
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-2">
      <ul className="grid gap-1 text-sm sm:grid-cols-2">
        {profiles.map((p) => (
          <li key={p.key}>
            <label className="flex items-center gap-2">
              <input type="checkbox" disabled={p.hired} checked={p.hired || picked.includes(p.key)} onChange={(e) => setPicked((x) => (e.target.checked ? [...x, p.key] : x.filter((k) => k !== p.key)))} />
              <span className={cn(p.hired && "text-muted-foreground")}>{p.label}</span>
              {p.hired ? <Check className="size-3.5 text-success" aria-label={t("product.team.hired")} /> : null}
            </label>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={busy || !picked.length} onClick={() => void run(() => api<{ hired: unknown[] }>(`${base}/product/team`, { body: { profiles: picked } }), (r) => (setResult(r.hired.length), setPicked([])))}>
          <Plus aria-hidden />
          {t("product.team.hire")}
        </Button>
        {result != null ? <span className="text-xs text-success">{t("product.team.hiredCount", { count: result })}</span> : null}
      </div>
      <FormError error={error} />
    </div>
  );
}

/** POSTs, then opens the created record (`hrefPrefix` + returned id). */
export function CreateAndOpen({ url, hrefPrefix, label, title, variant = "secondary" }: { url: string; hrefPrefix: string; label: string; title?: string; variant?: "secondary" | "ghost" }) {
  const router = useRouter();
  const { busy, error, run } = useAction();
  return (
    <span className="inline-grid gap-1">
      <Button type="button" size="sm" variant={variant} disabled={busy} title={title} onClick={() => void run(() => api<{ id: string }>(url, { body: {} }), (r) => router.push(`${hrefPrefix}${r.id}`))}>
        {label}
      </Button>
      <FormError error={error} />
    </span>
  );
}

// ─── Start here: guided idea intake ───

export interface StartValues {
  productId: string | null;
  name: string;
  description: string;
  targetUsers: string;
  hasProject: boolean;
}

/**
 * Three plain-language steps that turn an idea into a real product record. Every step saves on the server
 * (create, then update), so the flow resumes where it was left (/product/start?product=<id>).
 */
export function StartWizard({ base, locale, initial, startStep, aiAvailable }: { base: string; locale: string; initial: StartValues; startStep: number; aiAvailable: boolean }) {
  const t = useT();
  const router = useRouter();
  const [step, setStep] = useState(startStep);
  const [f, setF] = useState(initial);
  const [makeProject, setMakeProject] = useState(!initial.hasProject);
  const [askAi, setAskAi] = useState(aiAvailable);
  const [brief, setBrief] = useState("");
  const { busy, error, run } = useAction();
  const steps = ["idea", "audience", "setup"] as const;
  const examples = t("product.start.audienceExamples").split("|");

  const saveIdea = () =>
    run(
      async () => {
        if (f.productId) {
          await api(`${base}/product/products/${f.productId}`, { method: "PATCH", body: { name: f.name, description: f.description } });
          return f.productId;
        }
        const p = await api<{ id: string }>(`${base}/product/products`, { body: { name: f.name, description: f.description, createGraphEntity: true, createProject: false } });
        return p.id;
      },
      (id) => {
        setF((x) => ({ ...x, productId: id }));
        router.replace(`/${locale}/product/start?product=${id}`);
        setStep(1);
      },
    );
  const saveAudience = () => run(() => api(`${base}/product/products/${f.productId}`, { method: "PATCH", body: { targetUsers: f.targetUsers } }), () => setStep(2));
  const finish = () =>
    run(async () => {
      if (makeProject && !f.hasProject) await api(`${base}/product/products/${f.productId}/project`, { body: {} });
      if (askAi) await api(`${base}/product/products/${f.productId}/plan`, { body: { brief } });
      return f.productId;
    }, (id) => router.push(`/${locale}/product/${id}${askAi ? "/plan" : ""}`));

  return (
    <div className="grid gap-4">
      <ol className="grid grid-cols-3 gap-2" aria-label={t("product.start.progress", { step: step + 1, total: steps.length })}>
        {steps.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className="grid gap-1">
            <span className={cn("h-1.5 rounded-full", i < step ? "bg-success" : i === step ? "bg-brand-gradient" : "bg-muted")} />
            <span className={cn("text-xs", i === step ? "font-semibold text-primary" : "text-muted-foreground")}>
              {i + 1}. {t(`product.start.steps.${s}`)}
            </span>
          </li>
        ))}
      </ol>
      {step === 0 ? (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void saveIdea();
          }}
        >
          <h2 className="text-lg font-semibold">{t("product.start.ideaQuestion")}</h2>
          <p className="text-sm text-muted-foreground">{t("product.start.ideaHint")}</p>
          <Field label={t("product.start.nameLabel")} htmlFor="st-name" hint={t("product.start.nameExample")}>
            <Input id="st-name" value={f.name} maxLength={120} required autoFocus onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} />
          </Field>
          <Field label={t("product.start.problemLabel")} htmlFor="st-desc" hint={t("product.start.problemExample")}>
            <Textarea id="st-desc" rows={4} value={f.description} maxLength={5000} required onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))} />
          </Field>
          <div>
            <Button type="submit" disabled={busy || !f.name.trim() || !f.description.trim()}>
              {t("product.start.saveContinue")}
            </Button>
          </div>
        </form>
      ) : null}
      {step === 1 ? (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void saveAudience();
          }}
        >
          <h2 className="text-lg font-semibold">{t("product.start.audienceQuestion")}</h2>
          <p className="text-sm text-muted-foreground">{t("product.start.audienceHint")}</p>
          <div className="flex flex-wrap gap-1">
            {examples.map((ex) => (
              <button key={ex} type="button" className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted" onClick={() => setF((x) => ({ ...x, targetUsers: x.targetUsers ? `${x.targetUsers}, ${ex}` : ex }))}>
                + {ex}
              </button>
            ))}
          </div>
          <Field label={t("product.fields.targetUsers")} htmlFor="st-users">
            <Textarea id="st-users" rows={3} value={f.targetUsers} maxLength={2000} required onChange={(e) => setF((x) => ({ ...x, targetUsers: e.target.value }))} />
          </Field>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setStep(0)}>
              {t("product.start.back")}
            </Button>
            <Button type="submit" disabled={busy || !f.targetUsers.trim()}>
              {t("product.start.saveContinue")}
            </Button>
          </div>
        </form>
      ) : null}
      {step === 2 ? (
        <div className="grid gap-3">
          <h2 className="text-lg font-semibold">{t("product.start.setupQuestion")}</h2>
          <p className="text-sm text-muted-foreground">{t("product.start.setupHint")}</p>
          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <input type="checkbox" className="mt-1" checked={askAi} disabled={!aiAvailable} onChange={(e) => setAskAi(e.target.checked)} />
            <span>
              <span className="block font-medium">
                {t("product.start.aiOption")} <span className="text-xs text-primary">{t("product.start.recommended")}</span>
              </span>
              <span className="block text-muted-foreground">{aiAvailable ? t("product.start.aiOptionHint") : t("product.start.aiUnavailable")}</span>
            </span>
          </label>
          {askAi ? <Textarea aria-label={t("product.plan.brief")} placeholder={t("product.plan.briefPlaceholder")} rows={2} value={brief} maxLength={2000} onChange={(e) => setBrief(e.target.value)} /> : null}
          {!f.hasProject ? (
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input type="checkbox" className="mt-1" checked={makeProject} onChange={(e) => setMakeProject(e.target.checked)} />
              <span>
                <span className="block font-medium">
                  {t("product.start.projectOption")} <span className="text-xs text-primary">{t("product.start.recommended")}</span>
                </span>
                <span className="block text-muted-foreground">{t("product.start.projectOptionHint")}</span>
              </span>
            </label>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setStep(1)}>
              {t("product.start.back")}
            </Button>
            <Button type="button" disabled={busy || !f.productId} onClick={() => void finish()}>
              <Sparkles aria-hidden />
              {t("product.start.finish")}
            </Button>
          </div>
        </div>
      ) : null}
      <FormError error={error} />
    </div>
  );
}
