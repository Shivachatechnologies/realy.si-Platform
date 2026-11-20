"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

type SubjectType = "graph_entity" | "account" | "contact" | "project";
export interface DocumentLinkView {
  id: string;
  subjectType: SubjectType;
  subjectId: string;
  label: string | null;
  href: string;
}

/** A document's knowledge relationships: list, remove, and link to a graph entity, account, contact or project. */
export function DocumentLinks({
  organizationId,
  companyId,
  documentId,
  links,
  canManage,
  linkableTypes,
}: {
  organizationId: string;
  companyId: string;
  documentId: string;
  links: DocumentLinkView[];
  canManage: boolean;
  /** Subject types the viewer may read (and so link). */
  linkableTypes: SubjectType[];
}) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const base = `/api/v1/organizations/${organizationId}/companies/${companyId}/brain`;
  const [type, setType] = useState<SubjectType | "">(linkableTypes[0] ?? "");
  const [q, setQ] = useState("");
  const [targets, setTargets] = useState<{ id: string; label: string; detail: string | null }[]>([]);
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!canManage || !type) return;
    let stale = false;
    const id = setTimeout(async () => {
      try {
        const r = await api<{ data: { id: string; label: string; detail: string | null }[] }>(`${base}/link-targets?type=${type}&q=${encodeURIComponent(q)}`);
        if (stale) return;
        setTargets(r.data);
        setTargetId((cur) => (r.data.some((x) => x.id === cur) ? cur : (r.data[0]?.id ?? "")));
      } catch (e) {
        if (!stale) setError(e);
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(id);
    };
  }, [base, type, q, canManage]);

  async function run(call: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await call();
      router.refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!type || !targetId) return;
    await run(() => api(`${base}/documents/${documentId}/links`, { body: { subjectType: type, subjectId: targetId } }));
  }

  return (
    <div className="grid gap-3">
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("brain.links.empty")}</p>
      ) : (
        <ul className="grid gap-1.5">
          {links.map((l) => (
            <li key={l.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
              <Badge>{t(`brain.links.types.${l.subjectType}`)}</Badge>
              {l.label ? (
                <Link className="min-w-0 truncate hover:underline" href={`/${locale}${l.href}`}>
                  {l.label}
                </Link>
              ) : (
                <span className="text-muted-foreground">{t("brain.links.restricted")}</span>
              )}
              {canManage ? (
                <Button type="button" size="icon" variant="ghost" className="ms-auto size-7" aria-label={t("brain.links.remove")} disabled={busy} onClick={() => run(() => api(`${base}/links/${l.id}`, { method: "DELETE" }))}>
                  <Trash2 aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage && linkableTypes.length ? (
        <form onSubmit={add} className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <Field label={t("brain.links.type")} htmlFor="link-type">
            <Select id="link-type" value={type} onChange={(e) => setType(e.target.value as SubjectType)}>
              {linkableTypes.map((x) => (
                <option key={x} value={x}>
                  {t(`brain.links.types.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("brain.links.find")} htmlFor="link-q">
            <Input id="link-q" type="search" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} />
          </Field>
          <Field label={t("brain.links.record")} htmlFor="link-target">
            <Select id="link-target" value={targetId} disabled={!targets.length} onChange={(e) => setTargetId(e.target.value)}>
              {targets.length === 0 ? <option value="">{t("brain.links.noMatches")}</option> : null}
              {targets.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                  {x.detail ? ` · ${x.detail}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" disabled={busy || !targetId}>
            <Link2 aria-hidden />
            {t("brain.links.add")}
          </Button>
        </form>
      ) : null}
      <FormError error={error} />
    </div>
  );
}
