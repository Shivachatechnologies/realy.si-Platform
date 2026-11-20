"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import { LISTING_CATEGORIES, LISTING_TYPES, PRICING_MODELS } from "@/server/modules/marketplace/manifest";

function useSubmit() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  async function run<R>(fn: () => Promise<R>, after?: (r: R) => void) {
    setBusy(true);
    setError(null);
    setFields({});
    setDone(false);
    try {
      const r = await fn();
      setDone(true);
      after?.(r);
      router.refresh();
    } catch (e) {
      setError(e);
      if (e instanceof ApiError) setFields(e.fieldErrors());
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, fields, done, run };
}

export function PublisherForm({
  orgId,
  publisher,
}: {
  orgId: string;
  publisher: {
    name: string;
    slug: string;
    description: string;
    website: string | null;
    logoUrl: string | null;
  } | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState({
    name: publisher?.name ?? "",
    slug: publisher?.slug ?? "",
    description: publisher?.description ?? "",
    website: publisher?.website ?? "",
    logoUrl: publisher?.logoUrl ?? "",
  });
  const s = useSubmit();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void s.run(() =>
          api(`/api/v1/organizations/${orgId}/marketplace/publisher`, {
            method: "PUT",
            body: f,
          }),
        );
      }}
    >
      <Field label={t("marketplace.publish.publisherName")} htmlFor="pub-name" error={s.fields.name}>
        <Input id="pub-name" value={f.name} maxLength={80} required onChange={set("name")} />
      </Field>
      <Field label={t("marketplace.publish.handle")} htmlFor="pub-slug" hint={t("marketplace.publish.handleHint")} error={s.fields.slug}>
        <Input id="pub-slug" dir="ltr" className="font-mono" value={f.slug} maxLength={39} required onChange={(e) => setF((p) => ({ ...p, slug: e.target.value.toLowerCase() }))} />
      </Field>
      <Field label={t("marketplace.publish.website")} htmlFor="pub-web" error={s.fields.website}>
        <Input id="pub-web" type="url" dir="ltr" value={f.website} onChange={set("website")} />
      </Field>
      <Field label={t("marketplace.publish.logoUrl")} htmlFor="pub-logo" error={s.fields.logoUrl}>
        <Input id="pub-logo" type="url" dir="ltr" value={f.logoUrl} onChange={set("logoUrl")} />
      </Field>
      <Field label={t("marketplace.publish.description")} htmlFor="pub-desc" className="sm:col-span-2">
        <Textarea id="pub-desc" rows={3} maxLength={2000} value={f.description} onChange={set("description")} />
      </Field>
      <div className="grid gap-2 sm:col-span-2">
        <FormError error={s.error} />
        {s.done ? <Notice tone="success">{t("marketplace.publish.saved")}</Notice> : null}
        <div>
          <Button type="submit" disabled={s.busy || !f.name || !f.slug}>
            {publisher ? t("common.save") : t("marketplace.publish.createPublisher")}
          </Button>
        </div>
      </div>
    </form>
  );
}

export interface ListingFormValue {
  name: string;
  slug?: string;
  type: string;
  category: string;
  summary: string;
  description: string;
  tags: string;
  iconUrl: string;
  pricingModel: string;
  price: string;
  currency: string;
}

const EMPTY: ListingFormValue = {
  name: "",
  slug: "",
  type: "COMPANY_TEMPLATE",
  category: "operations",
  summary: "",
  description: "",
  tags: "",
  iconUrl: "",
  pricingModel: "FREE",
  price: "",
  currency: "USD",
};

export function ListingForm({ orgId, listingId, initial, onCreatedHref }: { orgId: string; listingId?: string; initial?: ListingFormValue; onCreatedHref?: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [f, setF] = useState<ListingFormValue>(initial ?? EMPTY);
  const s = useSubmit();
  const set = (k: keyof ListingFormValue) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const body = {
    ...f,
    slug: listingId ? undefined : f.slug || undefined,
    tags: f.tags
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
    price: f.pricingModel === "FREE" ? "" : f.price,
    currency: f.pricingModel === "FREE" ? "" : f.currency,
  };
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void s.run(
          () =>
            listingId
              ? api(`/api/v1/organizations/${orgId}/marketplace/listings/${listingId}`, { method: "PATCH", body })
              : api<{ id: string }>(`/api/v1/organizations/${orgId}/marketplace/listings`, { body }),
          (r) => {
            if (!listingId && onCreatedHref) router.push(`/${locale}${onCreatedHref}/${(r as { id: string }).id}`);
          },
        );
      }}
    >
      <Field label={t("marketplace.publish.name")} htmlFor="lst-name" error={s.fields.name}>
        <Input id="lst-name" value={f.name} maxLength={120} required onChange={set("name")} />
      </Field>
      {!listingId ? (
        <Field label={t("marketplace.publish.listingHandle")} htmlFor="lst-slug" hint={t("marketplace.publish.listingHandleHint")} error={s.fields.slug}>
          <Input id="lst-slug" dir="ltr" className="font-mono" value={f.slug} maxLength={59} onChange={(e) => setF((p) => ({ ...p, slug: e.target.value.toLowerCase() }))} />
        </Field>
      ) : (
        <div />
      )}
      <Field label={t("marketplace.publish.type")} htmlFor="lst-type">
        <Select id="lst-type" value={f.type} onChange={set("type")}>
          {LISTING_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`marketplace.types.${x}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("marketplace.category")} htmlFor="lst-cat">
        <Select id="lst-cat" value={f.category} onChange={set("category")}>
          {LISTING_CATEGORIES.map((x) => (
            <option key={x} value={x}>
              {t(`marketplace.categories.${x}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("marketplace.publish.summary")} htmlFor="lst-summary" hint={t("marketplace.publish.summaryHint")} error={s.fields.summary} className="sm:col-span-2">
        <Input id="lst-summary" value={f.summary} maxLength={240} required onChange={set("summary")} />
      </Field>
      <Field label={t("marketplace.publish.description")} htmlFor="lst-desc" className="sm:col-span-2">
        <Textarea id="lst-desc" rows={5} maxLength={10000} value={f.description} onChange={set("description")} />
      </Field>
      <Field label={t("marketplace.publish.tags")} htmlFor="lst-tags" hint={t("marketplace.publish.tagsHint")} error={s.fields.tags}>
        <Input id="lst-tags" value={f.tags} onChange={set("tags")} />
      </Field>
      <Field label={t("marketplace.publish.iconUrl")} htmlFor="lst-icon" error={s.fields.iconUrl}>
        <Input id="lst-icon" type="url" dir="ltr" value={f.iconUrl} onChange={set("iconUrl")} />
      </Field>
      <fieldset className="grid gap-3 rounded-md border p-3 sm:col-span-2 sm:grid-cols-3">
        <legend className="px-1 text-sm font-medium">{t("marketplace.pricing.label")}</legend>
        <Field label={t("marketplace.pricing.model")} htmlFor="lst-pricing">
          <Select id="lst-pricing" value={f.pricingModel} onChange={set("pricingModel")}>
            {PRICING_MODELS.map((x) => (
              <option key={x} value={x}>
                {t(`marketplace.pricing.models.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        {f.pricingModel !== "FREE" ? (
          <>
            <Field label={t("marketplace.pricing.price")} htmlFor="lst-price" error={s.fields.price}>
              <Input id="lst-price" inputMode="decimal" dir="ltr" pattern="\d{1,9}(\.\d{1,2})?" value={f.price} onChange={set("price")} />
            </Field>
            <Field label={t("marketplace.pricing.currency")} htmlFor="lst-cur" error={s.fields.currency}>
              <Input
                id="lst-cur"
                dir="ltr"
                maxLength={3}
                className="font-mono uppercase"
                value={f.currency}
                onChange={(e) =>
                  setF((p) => ({
                    ...p,
                    currency: e.target.value.toUpperCase(),
                  }))
                }
              />
            </Field>
            <p className="text-xs text-muted-foreground sm:col-span-3">{t("marketplace.pricing.paidHint")}</p>
          </>
        ) : null}
      </fieldset>
      <div className="grid gap-2 sm:col-span-2">
        <FormError error={s.error} />
        {s.done && listingId ? <Notice tone="success">{t("marketplace.publish.saved")}</Notice> : null}
        <div>
          <Button type="submit" disabled={s.busy || !f.name || f.summary.length < 10}>
            {listingId ? (
              t("common.save")
            ) : (
              <>
                <Plus aria-hidden />
                {t("marketplace.publish.createListing")}
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}

const EXAMPLE_MANIFEST = JSON.stringify(
  {
    departments: [{ name: "Customer Success", teams: [{ name: "Onboarding" }] }],
    projects: [
      {
        name: "Onboarding playbook",
        tasks: [{ title: "Write welcome email", priority: "HIGH", dueInDays: 7 }],
      },
    ],
    objectives: [
      {
        title: "Reduce time-to-value",
        targetInDays: 90,
        milestones: [
          {
            title: "Playbook live",
            dueInDays: 30,
            project: "Onboarding playbook",
          },
        ],
      },
    ],
    roles: [
      {
        key: "cs-lead",
        name: "CS lead",
        permissions: ["companies.read", "support.read", "support.manage"],
      },
    ],
    config: ["workspaceId", "startDate", "includeRoles", "includeProjects", "includeObjectives"],
  },
  null,
  2,
);

export function VersionForm({ orgId, listingId, suggested, previousManifest }: { orgId: string; listingId: string; suggested: string; previousManifest: string | null }) {
  const { t } = useI18n();
  const [version, setVersion] = useState(suggested);
  const [changelog, setChangelog] = useState("");
  const [manifest, setManifest] = useState(previousManifest ?? EXAMPLE_MANIFEST);
  const [parseError, setParseError] = useState(false);
  const s = useSubmit();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        let parsed: unknown;
        try {
          parsed = JSON.parse(manifest);
          setParseError(false);
        } catch {
          setParseError(true);
          return;
        }
        void s.run(
          () => api(`/api/v1/organizations/${orgId}/marketplace/listings/${listingId}/versions`, { body: { version, changelog, manifest: parsed } }),
          () => setChangelog(""),
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label={t("marketplace.publish.version")} htmlFor="ver-v" error={s.fields.version}>
          <Input id="ver-v" dir="ltr" className="font-mono" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" />
        </Field>
        <Field label={t("marketplace.publish.changelog")} htmlFor="ver-log">
          <Input id="ver-log" value={changelog} maxLength={4000} onChange={(e) => setChangelog(e.target.value)} />
        </Field>
      </div>
      <Field
        label={t("marketplace.publish.manifest")}
        htmlFor="ver-manifest"
        hint={t("marketplace.publish.manifestHint")}
        error={parseError ? t("marketplace.publish.invalidJson") : Object.entries(s.fields).find(([k]) => k.startsWith("manifest"))?.[1]}
      >
        <Textarea id="ver-manifest" dir="ltr" rows={14} className="font-mono text-xs" value={manifest} onChange={(e) => setManifest(e.target.value)} />
      </Field>
      <FormError error={s.error} />
      {s.done ? <Notice tone="success">{t("marketplace.publish.versionAdded")}</Notice> : null}
      <div>
        <Button type="submit" variant="secondary" disabled={s.busy || !version}>
          <Plus aria-hidden />
          {t("marketplace.publish.addVersion")}
        </Button>
      </div>
    </form>
  );
}

export function ListingActions({ orgId, listingId, canSubmit, canArchive }: { orgId: string; listingId: string; canSubmit: boolean; canArchive: boolean }) {
  const { t } = useI18n();
  const s = useSubmit();
  const [confirm, setConfirm] = useState(false);
  const url = `/api/v1/organizations/${orgId}/marketplace/listings/${listingId}`;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {canSubmit ? (
          <Button size="sm" disabled={s.busy} onClick={() => void s.run(() => api(`${url}/submit`, { method: "POST", body: {} }))}>
            <Send aria-hidden />
            {t("marketplace.publish.submit")}
          </Button>
        ) : null}
        {canArchive ? (
          confirm ? (
            <>
              <Button
                size="sm"
                variant="danger"
                disabled={s.busy}
                onClick={() =>
                  void s.run(
                    () => api(url, { method: "DELETE" }),
                    () => setConfirm(false),
                  )
                }
              >
                {t("marketplace.publish.confirmArchive")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                {t("common.cancel")}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
              <Archive aria-hidden />
              {t("marketplace.publish.archive")}
            </Button>
          )
        ) : null}
      </div>
      <FormError error={s.error} />
    </div>
  );
}

export function ReviewDecision({ listingId }: { listingId: string }) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const s = useSubmit();
  const decide = (decision: "approve" | "reject") =>
    void s.run(() =>
      api(`/api/v1/admin/marketplace/listings/${listingId}/review`, {
        body: { decision, note: note || undefined },
      }),
    );
  return (
    <div className="grid gap-2">
      <Field label={t("marketplace.review.note")} htmlFor={`note-${listingId}`} hint={t("marketplace.review.noteHint")}>
        <Textarea id={`note-${listingId}`} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <FormError error={s.error} />
      <div className="flex gap-2">
        <Button size="sm" disabled={s.busy} onClick={() => decide("approve")}>
          {t("marketplace.review.approve")}
        </Button>
        <Button size="sm" variant="danger" disabled={s.busy || !note.trim()} onClick={() => decide("reject")}>
          {t("marketplace.review.reject")}
        </Button>
      </div>
    </div>
  );
}
