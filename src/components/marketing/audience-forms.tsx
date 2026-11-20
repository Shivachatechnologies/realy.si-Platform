"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Search, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { splitList } from "./format";
import { useAction } from "./ui";

const ACCOUNT_TYPES = ["PROSPECT", "CUSTOMER", "PARTNER", "VENDOR", "OTHER"] as const;

interface SegmentValues {
  id?: string;
  name: string;
  description: string;
  kind: "DYNAMIC" | "STATIC";
  tags: string;
  accountTypes: string[];
  consentOnly: boolean;
}

export function SegmentForm({ base, locale, initial, knownTags }: { base: string; locale: string; initial?: SegmentValues; knownTags: string[] }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState<SegmentValues>(initial ?? { name: "", description: "", kind: "DYNAMIC", tags: "", accountTypes: [], consentOnly: true });
  const { busy, error, run } = useAction();
  const editing = !!initial?.id;
  return (
    <form
      className="grid gap-3 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const body = { name: f.name, description: f.description, tags: splitList(f.tags), accountTypes: f.accountTypes, consentOnly: f.consentOnly, ...(editing ? {} : { kind: f.kind }) };
        void run(
          () => (editing ? api(`${base}/segments/${initial!.id}`, { method: "PATCH", body }) : api<{ id: string }>(`${base}/segments`, { body })),
          (r) => !editing && router.push(`/${locale}/marketing/audience/${(r as { id: string }).id}`),
        );
      }}
    >
      <Field label={t("marketing.audience.name")} htmlFor="seg-name">
        <Input id="seg-name" value={f.name} maxLength={120} required onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} />
      </Field>
      <Field label={t("marketing.audience.kind")} htmlFor="seg-kind">
        <Select id="seg-kind" value={f.kind} disabled={editing} onChange={(e) => setF((p) => ({ ...p, kind: e.target.value as SegmentValues["kind"] }))}>
          <option value="DYNAMIC">{t("marketing.audience.kinds.DYNAMIC")}</option>
          <option value="STATIC">{t("marketing.audience.kinds.STATIC")}</option>
        </Select>
      </Field>
      <Field label={t("marketing.audience.description")} htmlFor="seg-desc" className="sm:col-span-2">
        <Input id="seg-desc" value={f.description} maxLength={1000} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} />
      </Field>
      {f.kind === "DYNAMIC" ? (
        <>
          <Field label={t("marketing.audience.tags")} htmlFor="seg-tags" hint={knownTags.length ? t("marketing.audience.knownTags", { tags: knownTags.slice(0, 20).join(", ") }) : t("marketing.common.commaSeparated")}>
            <Input id="seg-tags" value={f.tags} list="seg-tag-list" onChange={(e) => setF((p) => ({ ...p, tags: e.target.value }))} />
            <datalist id="seg-tag-list">
              {knownTags.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </Field>
          <fieldset className="grid gap-1.5">
            <legend className="text-sm font-medium">{t("marketing.audience.accountTypes")}</legend>
            <div className="flex flex-wrap gap-2">
              {ACCOUNT_TYPES.map((a) => (
                <label key={a} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                  <input type="checkbox" checked={f.accountTypes.includes(a)} onChange={(e) => setF((p) => ({ ...p, accountTypes: e.target.checked ? [...p.accountTypes, a] : p.accountTypes.filter((x) => x !== a) }))} />
                  {t(`marketing.audience.accountType.${a}`)}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      ) : null}
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={f.consentOnly} onChange={(e) => setF((p) => ({ ...p, consentOnly: e.target.checked }))} />
        {t("marketing.audience.consentOnly")}
      </label>
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={busy || !f.name.trim()}>
          {editing ? <Save aria-hidden /> : <Plus aria-hidden />}
          {editing ? t("common.save") : t("marketing.audience.create")}
        </Button>
      </div>
      <div className="sm:col-span-2">
        <FormError error={error} />
      </div>
    </form>
  );
}

interface ContactHit {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  marketingConsent: boolean;
  unsubscribedAt: string | null;
}

/** Search CRM contacts and add them to a static list. */
export function MemberPicker({ base, segmentId }: { base: string; segmentId: string }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ContactHit[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const search = useAction();
  const add = useAction();
  return (
    <div className="grid gap-2 p-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search.run(() => api<{ data: ContactHit[] }>(`${base}/contacts?q=${encodeURIComponent(q)}`), (r) => setHits(r.data));
        }}
      >
        <Input type="search" value={q} maxLength={200} aria-label={t("marketing.audience.searchContacts")} placeholder={t("marketing.audience.searchContacts")} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" size="sm" className="h-9" variant="secondary" disabled={search.busy}>
          <Search aria-hidden />
          {t("marketing.common.search")}
        </Button>
      </form>
      <FormError error={search.error} />
      {hits && hits.length === 0 ? <p className="text-xs text-muted-foreground">{t("common.noResults")}</p> : null}
      {hits?.length ? (
        <ul className="grid max-h-64 gap-1 overflow-auto rounded-md border p-2 text-sm">
          {hits.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={picked.includes(c.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
                <span>
                  {c.firstName} {c.lastName ?? ""}
                </span>
                <span className="text-xs text-muted-foreground">{c.email ?? "—"}</span>
                {c.unsubscribedAt ? <span className="text-xs text-warning">{t("marketing.audience.unsubscribed")}</span> : !c.marketingConsent ? <span className="text-xs text-muted-foreground">{t("marketing.audience.noConsent")}</span> : null}
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      {picked.length ? (
        <div>
          <Button type="button" size="sm" disabled={add.busy} onClick={() => void add.run(() => api(`${base}/segments/${segmentId}/members`, { body: { action: "add", contactIds: picked } }), () => setPicked([]))}>
            <UserPlus aria-hidden />
            {t("marketing.audience.addMembers", { count: picked.length })}
          </Button>
        </div>
      ) : null}
      <FormError error={add.error} />
    </div>
  );
}

export function RemoveMember({ base, segmentId, contactId }: { base: string; segmentId: string; contactId: string }) {
  const t = useT();
  const { busy, error, run } = useAction();
  return (
    <span className="inline-grid">
      <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={t("marketing.audience.removeMember")} onClick={() => void run(() => api(`${base}/segments/${segmentId}/members`, { body: { action: "remove", contactIds: [contactId] } }))}>
        <UserMinus aria-hidden />
      </Button>
      <FormError error={error} />
    </span>
  );
}
