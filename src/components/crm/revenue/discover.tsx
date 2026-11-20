"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Globe, Plus, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "../kit";

/** "Who do you sell to?" form → real web results from the connected research provider. */
export function DiscoverForm({ base, locale, initialAudience = "" }: { base: string; locale: string; initialAudience?: string }) {
  const t = useT();
  const router = useRouter();
  const { busy, error, run } = useAction();
  const [audience, setAudience] = useState(initialAudience);
  const [location, setLocation] = useState("");
  const [extra, setExtra] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(
      () => api<{ id: string }>(`${base}/crm/discover`, { body: { audience, location: location || undefined, extra: extra || undefined, maxResults: 10 } }),
      (r) => router.replace(`/${locale}/crm/discover?search=${r.id}`),
    );
  };
  return (
    <form onSubmit={submit} className="grid gap-3" aria-busy={busy}>
      <Field label={t("crm.rev.discover.audience")} htmlFor="d-audience" hint={t("crm.rev.discover.audienceHint")}>
        <Input id="d-audience" value={audience} onChange={(e) => setAudience(e.target.value)} minLength={3} maxLength={300} required placeholder={t("crm.rev.discover.audiencePlaceholder")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("crm.rev.discover.location")} htmlFor="d-location">
          <Input id="d-location" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} placeholder={t("crm.rev.discover.locationPlaceholder")} />
        </Field>
        <Field label={t("crm.rev.discover.extra")} htmlFor="d-extra">
          <Input id="d-extra" value={extra} onChange={(e) => setExtra(e.target.value)} maxLength={200} placeholder={t("crm.rev.discover.extraPlaceholder")} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="luminous" disabled={busy} aria-busy={busy}>
          <Search aria-hidden />
          {busy ? t("crm.rev.discover.searching") : t("crm.rev.discover.search")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("crm.rev.discover.honest")}</span>
      </div>
      <FormError error={error} />
    </form>
  );
}

export interface ProspectView {
  id: string;
  title: string;
  url: string;
  domain: string | null;
  snippet: string;
  status: "NEW" | "ADDED" | "DISMISSED";
  suggestedName: string;
  leadId: string | null;
  knownLeadId: string | null;
}

/** One real result: add as a lead (name editable, email only if you know it) or dismiss. */
export function ProspectCard({ base, locale, p, canManage }: { base: string; locale: string; p: ProspectView; canManage: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(p.suggestedName);
  const [email, setEmail] = useState("");
  return (
    <article className={`grid gap-2 rounded-xl border bg-surface p-4 shadow-elev-1 ${p.status === "DISMISSED" ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Globe className="size-4" />
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-medium hover:underline">
            <span className="truncate">{p.title}</span>
            <ExternalLink className="size-3.5 shrink-0" aria-hidden />
          </a>
          {p.domain ? <span className="text-xs text-muted-foreground">{p.domain}</span> : null}
          {p.snippet ? <p className="line-clamp-3 text-sm text-muted-foreground">{p.snippet}</p> : null}
        </div>
        {p.status === "ADDED" ? <Badge tone="success">{t("crm.rev.discover.added")}</Badge> : p.status === "DISMISSED" ? <Badge>{t("crm.rev.discover.dismissed")}</Badge> : null}
      </div>
      {p.knownLeadId && p.status !== "ADDED" ? (
        <p className="ps-12 text-xs text-warning">
          <Link href={`/${locale}/crm/${p.knownLeadId}`} className="underline">
            {t("crm.rev.discover.known")}
          </Link>
        </p>
      ) : null}
      {p.status === "ADDED" && p.leadId ? (
        <Link href={`/${locale}/crm/${p.leadId}`} className="ps-12 text-sm text-primary underline">
          {t("crm.rev.discover.openLead")}
        </Link>
      ) : null}
      {p.status === "NEW" && canManage ? (
        open ? (
          <form
            className="grid gap-2 ps-12 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api(`${base}/crm/prospects/${p.id}`, { body: { name, email } }));
            }}
          >
            <Field label={t("crm.name")} htmlFor={`pn-${p.id}`}>
              <Input id={`pn-${p.id}`} value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
            </Field>
            <Field label={t("crm.rev.discover.emailIfKnown")} htmlFor={`pe-${p.id}`}>
              <Input id={`pe-${p.id}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
            </Field>
            <Button type="submit" disabled={busy} aria-busy={busy}>
              <Plus aria-hidden />
              {t("crm.rev.discover.create")}
            </Button>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2 ps-12">
            <Button type="button" size="sm" onClick={() => setOpen(true)}>
              <Plus aria-hidden />
              {t("crm.rev.discover.addAsLead")}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api(`${base}/crm/prospects/${p.id}`, { method: "DELETE" }))}>
              <X aria-hidden />
              {t("crm.rev.discover.dismiss")}
            </Button>
          </div>
        )
      ) : null}
      <FormError error={error} />
    </article>
  );
}
