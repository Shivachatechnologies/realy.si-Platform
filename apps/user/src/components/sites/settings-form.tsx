"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Copy, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { formatDateTime } from "@/i18n/format";
import { LOCALE_NAMES, type AppLocale } from "@/i18n/config";
import { api } from "@/lib/api-client";
import { SITE_LOCALES, type SiteFooter, type SiteNav, type SiteSeo, type SiteTheme } from "@/server/modules/sites/schemas";
import { ThemeFields } from "./setup-wizard";

type Link = { label: string; href: string };

function LinksEditor({ id, links, onChange, max, disabled }: { id: string; links: Link[]; onChange: (v: Link[]) => void; max: number; disabled: boolean }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-2">
      {links.map((l, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-2">
          <Input aria-label={`${t("sites.settings.linkLabel")} ${i + 1}`} placeholder={t("sites.settings.linkLabel")} value={l.label} maxLength={40} disabled={disabled} onChange={(e) => onChange(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <Input aria-label={`${t("sites.settings.linkHref")} ${i + 1}`} placeholder="/about" value={l.href} maxLength={500} disabled={disabled} className="font-mono" onChange={(e) => onChange(links.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)))} />
          <Button size="icon" variant="ghost" aria-label={t("sites.editor.remove")} disabled={disabled} onClick={() => onChange(links.filter((_, j) => j !== i))}>
            <X aria-hidden />
          </Button>
        </div>
      ))}
      {links.length < max ? (
        <Button id={id} size="sm" variant="secondary" className="w-fit" disabled={disabled} onClick={() => onChange([...links, { label: "", href: "/" }])}>
          <Plus aria-hidden />
          {t("sites.settings.addLink")}
        </Button>
      ) : null}
    </div>
  );
}

/** Site settings: name, address, language, theme, navigation, footer, SEO defaults. */
export function SiteSettingsForm({
  base,
  site,
  logos,
  pages,
  canManage,
}: {
  base: string;
  site: { name: string; slug: string; locale: string; theme: SiteTheme; nav: SiteNav; footer: SiteFooter; seo: SiteSeo };
  logos: { id: string; url: string; title: string | null }[];
  pages: { slug: string; title: string }[];
  canManage: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [s, setS] = useState(site);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const disabled = !canManage;
  const patch = (p: Partial<typeof s>) => (setS({ ...s, ...p }), setSaved(false));
  const setTheme = <K extends keyof SiteTheme>(k: K, v: SiteTheme[K]) => patch({ theme: { ...s.theme, [k]: v } });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/sites`, { method: "PATCH", body: { name: s.name, slug: s.slug, locale: s.locale, theme: s.theme, nav: s.nav.filter((l) => l.label.trim()), footer: { ...s.footer, links: s.footer.links.filter((l) => l.label.trim()) }, seo: s.seo } });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("sites.settings.general")} />
          <CardBody className="grid gap-3">
            <Field label={t("sites.fields.name")} htmlFor="st-name">
              <Input id="st-name" value={s.name} maxLength={120} disabled={disabled} onChange={(e) => patch({ name: e.target.value })} />
            </Field>
            <Field label={t("sites.fields.slug")} htmlFor="st-slug" hint={t("sites.settings.slugWarning")}>
              <Input id="st-slug" value={s.slug} maxLength={48} disabled={disabled} className="font-mono" onChange={(e) => patch({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
            </Field>
            <Field label={t("sites.fields.locale")} htmlFor="st-locale">
              <Select id="st-locale" value={s.locale} disabled={disabled} onChange={(e) => patch({ locale: e.target.value })}>
                {SITE_LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {LOCALE_NAMES[l as AppLocale]}
                  </option>
                ))}
              </Select>
            </Field>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("sites.settings.theme")} description={t("sites.settings.themeHint")} />
          <CardBody>
            <fieldset disabled={disabled}>
              <ThemeFields theme={s.theme} set={setTheme} logos={logos} />
            </fieldset>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("sites.settings.nav")} description={t("sites.settings.navHint")} />
          <CardBody className="grid gap-3">
            <LinksEditor id="st-nav" links={s.nav} max={8} disabled={disabled} onChange={(nav) => patch({ nav })} />
            {pages.length ? (
              <p className="text-xs text-muted-foreground">
                {t("sites.settings.pagesAvailable")} {pages.map((p) => `/${p.slug}`).join(", ")}
              </p>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("sites.settings.footer")} />
          <CardBody className="grid gap-3">
            <Field label={t("sites.settings.footerText")} htmlFor="st-ft">
              <Textarea id="st-ft" rows={2} maxLength={400} value={s.footer.text} disabled={disabled} onChange={(e) => patch({ footer: { ...s.footer, text: e.target.value } })} />
            </Field>
            <LinksEditor id="st-fl" links={s.footer.links} max={8} disabled={disabled} onChange={(links) => patch({ footer: { ...s.footer, links } })} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={s.footer.showPoweredBy} disabled={disabled} onChange={(e) => patch({ footer: { ...s.footer, showPoweredBy: e.target.checked } })} />
              {t("sites.settings.poweredBy")}
            </label>
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title={t("sites.settings.seo")} description={t("sites.settings.seoHint")} />
          <CardBody className="grid gap-3 md:grid-cols-2">
            <Field label={t("sites.editor.seoTitle")} htmlFor="st-seot" hint={`${s.seo.title.length}/70`}>
              <Input id="st-seot" value={s.seo.title} maxLength={70} disabled={disabled} onChange={(e) => patch({ seo: { ...s.seo, title: e.target.value } })} />
            </Field>
            <Field label={t("sites.editor.ogImage")} htmlFor="st-og">
              <Select id="st-og" value={s.seo.ogImage.replace(/^asset:/, "")} disabled={disabled || !logos.length} onChange={(e) => patch({ seo: { ...s.seo, ogImage: e.target.value ? `asset:${e.target.value}` : "" } })}>
                <option value="">{t("sites.editor.noImage")}</option>
                {logos.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title || a.id.slice(0, 8)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("sites.editor.seoDescription")} htmlFor="st-seod" hint={`${s.seo.description.length}/170`} className="md:col-span-2">
              <Textarea id="st-seod" rows={2} maxLength={170} value={s.seo.description} disabled={disabled} onChange={(e) => patch({ seo: { ...s.seo, description: e.target.value } })} />
            </Field>
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input type="checkbox" className="size-4" checked={s.seo.noIndex} disabled={disabled} onChange={(e) => patch({ seo: { ...s.seo, noIndex: e.target.checked } })} />
              {t("sites.settings.noIndex")}
            </label>
          </CardBody>
        </Card>
      </div>
      <FormError error={error} />
      {saved ? <Notice tone="success">{t("sites.settings.saved")}</Notice> : null}
      <div className="sticky bottom-3 flex justify-end">
        <Button variant="luminous" onClick={save} loading={busy} disabled={disabled}>
          <Save aria-hidden />
          {t("sites.settings.save")}
        </Button>
      </div>
    </div>
  );
}

/** Custom domain: TXT verification with a real DNS lookup and an honest status (routing is a separate step). */
export function DomainPanel({
  base,
  site,
  txtName,
  txtValue,
  canManage,
  tz,
}: {
  base: string;
  site: { slug: string; customDomain: string | null; domainStatus: "NONE" | "PENDING" | "VERIFIED" | "FAILED"; domainCheckedAt: string | null; domainVerifiedAt: string | null; domainError: string | null };
  txtName: string | null;
  txtValue: string | null;
  canManage: boolean;
  tz: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [domain, setDomain] = useState(site.customDomain ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const call = async (action: "set" | "verify" | "remove") => {
    if (action === "remove" && !window.confirm(t("sites.domain.removeConfirm"))) return;
    setBusy(action);
    setError(null);
    try {
      await api(`${base}/sites/domain`, { body: action === "set" ? { action, domain } : { action } });
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };
  const copy = async (v: string) => {
    await navigator.clipboard?.writeText(v).catch(() => undefined);
    setCopied(v);
  };
  const tone = { NONE: "neutral", PENDING: "warning", VERIFIED: "success", FAILED: "danger" } as const;
  const steps: { key: string; done: boolean }[] = [
    { key: "add", done: !!site.customDomain },
    { key: "txt", done: site.domainStatus === "VERIFIED" },
    { key: "route", done: false },
  ];
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader title={t("sites.domain.title")} description={t("sites.domain.description", { path: `/s/${site.slug}` })} actions={<Badge tone={tone[site.domainStatus]}>{t(`sites.domain.status.${site.domainStatus}`)}</Badge>} />
        <CardBody className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Field label={t("sites.domain.domain")} htmlFor="dm-domain" hint={t("sites.domain.domainHint")}>
              <Input id="dm-domain" value={domain} placeholder="www.example.com" maxLength={253} disabled={!canManage} className="font-mono" onChange={(e) => setDomain(e.target.value.trim().toLowerCase())} />
            </Field>
            <Button onClick={() => call("set")} loading={busy === "set"} disabled={!canManage || !domain || domain === site.customDomain}>
              {t("sites.domain.save")}
            </Button>
          </div>
          {site.customDomain && txtName && txtValue ? (
            <div className="grid gap-3 rounded-xl border bg-surface-2/60 p-4">
              <p className="text-sm font-medium">{t("sites.domain.txtTitle")}</p>
              <dl className="grid gap-2 text-sm">
                {[
                  [t("sites.domain.recordType"), "TXT"],
                  [t("sites.domain.recordName"), txtName],
                  [t("sites.domain.recordValue"), txtValue],
                ].map(([k, v]) => (
                  <div key={k} className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-center">
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="truncate font-mono text-[13px]">{v}</dd>
                    {v !== "TXT" ? (
                      <Button size="sm" variant="ghost" onClick={() => copy(v!)} aria-label={t("sites.domain.copy")}>
                        <Copy aria-hidden />
                        {copied === v ? t("sites.domain.copied") : t("sites.domain.copy")}
                      </Button>
                    ) : (
                      <span />
                    )}
                  </div>
                ))}
              </dl>
              <p className="text-xs text-muted-foreground">{t("sites.domain.txtHint")}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => call("verify")} loading={busy === "verify"} disabled={!canManage}>
                  <RefreshCw aria-hidden />
                  {t("sites.domain.verify")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => call("remove")} loading={busy === "remove"} disabled={!canManage}>
                  <Trash2 aria-hidden />
                  {t("sites.domain.remove")}
                </Button>
              </div>
              {site.domainCheckedAt ? (
                <p className="text-xs text-muted-foreground">
                  {t("sites.domain.lastChecked", { when: formatDateTime(site.domainCheckedAt, locale, tz) })}
                  {site.domainError ? ` — ${t(`sites.domain.errors.${site.domainError}`)}` : ""}
                </p>
              ) : null}
            </div>
          ) : null}
          <FormError error={error} />
          {site.domainStatus === "VERIFIED" ? (
            <Notice tone="info" title={t("sites.domain.verifiedTitle")}>
              {t("sites.domain.verifiedBody", { path: `/s/${site.slug}` })}
            </Notice>
          ) : null}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("sites.domain.stepsTitle")} />
        <CardBody>
          <ol className="grid gap-3 text-sm">
            {steps.map((s, i) => (
              <li key={s.key} className="flex gap-3">
                {s.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
                <div className="grid gap-0.5">
                  <span className="font-medium">
                    {i + 1}. {t(`sites.domain.steps.${s.key}`)}
                  </span>
                  <span className="text-xs text-muted-foreground">{t(`sites.domain.steps.${s.key}Hint`)}</span>
                </div>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}
