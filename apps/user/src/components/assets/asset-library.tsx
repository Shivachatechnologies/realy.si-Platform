"use client";

import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Download, Pin, Search, Shuffle, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { WorldIllustration } from "@/components/graphics/illustrations";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ASSET_SCOPES, SCOPE_WORLD, assetFileUrl, type AssetScope } from "@/server/modules/assets/presets";
import { AssetThumb } from "./asset-thumb";
import { GenerateArtworkDialog, type AssetLite, type ScopeOptions } from "./generate-dialog";

export interface LibraryAsset extends AssetLite {
  provider: string | null;
  model: string | null;
  source: "GENERATED" | "UPLOADED";
  sizeBytes: number;
  createdAt: string;
}

/**
 * The asset library: a masonry-like gallery filtered by scope (URL state), searchable, paginated with "load more",
 * and a detail panel to rename, pin to its scope, move, vary, download or delete. Thumbnails load lazily.
 */
export function AssetLibrary({
  organizationId,
  companyId,
  initial,
  nextCursor: initialCursor,
  counts,
  canManage,
  connected,
  scopes,
}: {
  organizationId: string;
  companyId: string;
  initial: LibraryAsset[];
  nextCursor: string | null;
  counts: Partial<Record<AssetScope, number>>;
  canManage: boolean;
  connected: string[];
  scopes: ScopeOptions;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const base = `/api/v1/organizations/${organizationId}/companies/${companyId}`;
  const scope = (params.get("scope") as AssetScope | null) ?? null;
  const [q, setQ] = useState(params.get("q") ?? "");
  const [extra, setExtra] = useState<LibraryAsset[]>([]);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<LibraryAsset | null>(null);
  const [error, setError] = useState<unknown>(null);
  const items = [...initial, ...extra.filter((e) => !initial.some((i) => i.id === e.id))];
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const scopeName = (a: LibraryAsset) => (a.scopeId ? scopes[a.scopeType]?.find((o) => o.id === a.scopeId)?.name : null);

  function setParam(k: string, v: string | null) {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setExtra([]);
    router.push(`${pathname}?${next.toString()}`);
  }
  async function more() {
    if (!cursor) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ cursor, ...(scope ? { scopeType: scope } : {}), ...(params.get("q") ? { q: params.get("q")! } : {}) });
      const r = await api<{ data: LibraryAsset[]; nextCursor: string | null }>(`${base}/assets?${qs}`);
      setExtra((x) => [...x, ...r.data]);
      setCursor(r.nextCursor);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }
  async function patch(a: LibraryAsset, body: Record<string, unknown>) {
    setError(null);
    try {
      const r = await api<LibraryAsset>(`${base}/assets/${a.id}`, { method: "PATCH", body });
      setSelected({ ...a, ...r, createdAt: a.createdAt });
      router.refresh();
    } catch (err) {
      setError(err);
    }
  }
  async function remove(a: LibraryAsset) {
    if (!window.confirm(t("assets.detail.deleteConfirm"))) return;
    try {
      await api(`${base}/assets/${a.id}`, { method: "DELETE" });
      setSelected(null);
      setExtra((x) => x.filter((i) => i.id !== a.id));
      router.refresh();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label={t("assets.filterByScope")} className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setParam("scope", null)} aria-pressed={!scope} className={cn("rounded-full border px-3 py-1 text-xs transition-colors", !scope ? "border-primary bg-accent font-medium text-accent-foreground" : "hover:bg-muted")}>
            {t("assets.scopes.ALL")} <span className="numeral opacity-70">{total}</span>
          </button>
          {ASSET_SCOPES.map((s) => (
            <button key={s} type="button" onClick={() => setParam("scope", s)} aria-pressed={scope === s} className={cn("rounded-full border px-3 py-1 text-xs transition-colors", scope === s ? "border-primary bg-accent font-medium text-accent-foreground" : "hover:bg-muted")}>
              {t(`assets.scopes.${s}`)} <span className="numeral opacity-70">{counts[s] ?? 0}</span>
            </button>
          ))}
        </nav>
        <form
          className="ms-auto flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setParam("q", q.trim() || null);
          }}
        >
          <label htmlFor="asset-q" className="sr-only">
            {t("assets.search")}
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="asset-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("assets.search")} className="w-56 ps-8" />
          </div>
        </form>
      </div>

      {items.length === 0 ? (
        <div className="grid place-items-center gap-4 rounded-3xl border border-dashed px-6 py-14 text-center">
          <WorldIllustration world={scope ? SCOPE_WORLD[scope] : "brain"} className="w-56" />
          <div className="grid max-w-md gap-1">
            <p className="font-display text-display-lg">{t("assets.empty.title")}</p>
            <p className="text-sm text-muted-foreground">{t("assets.empty.body")}</p>
          </div>
          {canManage ? <GenerateArtworkDialog organizationId={organizationId} companyId={companyId} connected={connected} scopes={scopes} defaultScope={scope ? { type: scope, id: null } : undefined} /> : null}
        </div>
      ) : (
        <ul className="columns-2 gap-3 sm:columns-3 xl:columns-4 [&>li]:mb-3">
          {items.map((a) => (
            <li key={a.id} className="break-inside-avoid">
              <button type="button" onClick={() => setSelected(a)} className="group relative block w-full overflow-hidden rounded-xl text-start focus-visible:outline-2" aria-label={a.title ?? a.prompt ?? t("assets.untitled")}>
                <AssetThumb src={assetFileUrl(organizationId, companyId, a.id)} alt="" ratio={a.aspectRatio} className="transition-transform duration-500 group-hover:scale-[1.02]" />
                <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent p-2.5 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  <span className="line-clamp-2 text-xs">{a.title ?? a.prompt}</span>
                  {a.pinned ? <Pin className="size-3.5 shrink-0" aria-hidden /> : null}
                </span>
                <span className="absolute start-2 top-2">
                  <Badge tone="neutral" className="bg-black/45 text-white backdrop-blur">{t(`assets.scopes.${a.scopeType}`)}</Badge>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={more} loading={loading}>
            {t("assets.loadMore")}
          </Button>
        </div>
      ) : null}
      <FormError error={error} />

      {selected ? (
        <div role="dialog" aria-modal="false" aria-label={selected.title ?? t("assets.untitled")} className="panel-float fixed inset-x-3 bottom-3 z-40 grid max-h-[85vh] gap-4 overflow-y-auto p-4 sm:inset-x-auto sm:end-4 sm:top-20 sm:bottom-4 sm:w-[24rem]">
          <div className="flex items-start justify-between gap-2">
            <p className="font-display text-xl">{selected.title ?? t("assets.untitled")}</p>
            <button type="button" onClick={() => setSelected(null)} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label={t("common.close")}>
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <AssetThumb src={assetFileUrl(organizationId, companyId, selected.id)} alt={selected.prompt ?? ""} ratio={selected.aspectRatio} sizes="24rem" />
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
            {selected.prompt ? (
              <>
                <dt className="text-muted-foreground">{t("assets.detail.prompt")}</dt>
                <dd>{selected.prompt}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{t("assets.detail.scope")}</dt>
            <dd>
              {t(`assets.scopes.${selected.scopeType}`)}
              {scopeName(selected) ? ` · ${scopeName(selected)}` : ""}
              {selected.pinned ? ` · ${t("assets.detail.pinned")}` : ""}
            </dd>
            {selected.stylePreset ? (
              <>
                <dt className="text-muted-foreground">{t("assets.detail.style")}</dt>
                <dd>{t(`assets.styles.${selected.stylePreset}`)}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{t("assets.detail.source")}</dt>
            <dd>{selected.source === "UPLOADED" ? t("assets.detail.uploaded") : [selected.provider, selected.model].filter(Boolean).join(" · ")}</dd>
            <dt className="text-muted-foreground">{t("assets.detail.created")}</dt>
            <dd>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(selected.createdAt))}</dd>
          </dl>
          {canManage ? (
            <div className="grid gap-3">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = String(new FormData(e.currentTarget).get("title") ?? "").trim();
                  patch(selected, { title: v || null });
                }}
              >
                <label htmlFor="asset-title" className="sr-only">
                  {t("assets.detail.rename")}
                </label>
                <Input id="asset-title" name="title" defaultValue={selected.title ?? ""} key={selected.id} maxLength={160} placeholder={t("assets.detail.rename")} />
                <Button type="submit" variant="secondary">
                  {t("common.save")}
                </Button>
              </form>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  aria-label={t("assets.detail.moveTo")}
                  value={selected.scopeType}
                  onChange={(e) => {
                    const st = e.target.value as AssetScope;
                    if (st === "BRAND") patch(selected, { scopeType: st, scopeId: null });
                    else setSelected({ ...selected, scopeType: st, scopeId: null });
                  }}
                >
                  {ASSET_SCOPES.map((s) => (
                    <option key={s} value={s}>
                      {t(`assets.scopes.${s}`)}
                    </option>
                  ))}
                </Select>
                {selected.scopeType !== "BRAND" ? (
                  <Select aria-label={t("assets.dialog.scopeRecord")} value={selected.scopeId ?? ""} onChange={(e) => e.target.value && patch(selected, { scopeType: selected.scopeType, scopeId: e.target.value })}>
                    <option value="">{t("assets.dialog.scopeChoose")}</option>
                    {(scopes[selected.scopeType] ?? []).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={selected.pinned ? "soft" : "secondary"} onClick={() => patch(selected, { pinned: !selected.pinned })}>
                  <Pin aria-hidden />
                  {selected.pinned ? t("assets.detail.unpin") : t("assets.detail.pin")}
                </Button>
                {selected.source === "GENERATED" ? (
                  <GenerateArtworkDialog
                    organizationId={organizationId}
                    companyId={companyId}
                    connected={connected}
                    scopes={scopes}
                    parent={selected}
                    trigger={
                      <Button size="sm" variant="secondary">
                        <Shuffle aria-hidden />
                        {t("assets.dialog.vary")}
                      </Button>
                    }
                  />
                ) : null}
                <Button asChild size="sm" variant="secondary">
                  <a href={assetFileUrl(organizationId, companyId, selected.id, { download: true })}>
                    <Download aria-hidden />
                    {t("assets.dialog.download")}
                  </a>
                </Button>
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => remove(selected)}>
                  <Trash2 aria-hidden />
                  {t("assets.detail.delete")}
                </Button>
              </div>
            </div>
          ) : (
            <Button asChild size="sm" variant="secondary">
              <a href={assetFileUrl(organizationId, companyId, selected.id, { download: true })}>
                <Download aria-hidden />
                {t("assets.dialog.download")}
              </a>
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
