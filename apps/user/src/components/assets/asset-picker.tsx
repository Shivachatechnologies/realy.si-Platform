"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { assetFileUrl, type AssetScope } from "@/server/modules/assets/presets";
import { AssetThumb } from "./asset-thumb";
import { GenerateArtworkDialog, type AssetLite } from "./generate-dialog";

/**
 * Choose the artwork of a scope (a department, campaign, project, AI employee, product or the brand): pick from the
 * company's asset library or generate new artwork for it. The choice is what <ScopeArtwork> shows.
 *
 *   <AssetPicker organizationId={org.id} companyId={company.id} scopeType="CAMPAIGN" scopeId={campaign.id} connected={providers} />
 */
export function AssetPicker({ organizationId, companyId, scopeType, scopeId, connected, label, className }: { organizationId: string; companyId: string; scopeType: AssetScope; scopeId: string | null; connected: string[]; label?: string; className?: string }) {
  const t = useT();
  const router = useRouter();
  const base = `/api/v1/organizations/${organizationId}/companies/${companyId}`;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AssetLite[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open || items) return;
    let live = true;
    api<{ data: AssetLite[] }>(`${base}/assets?limit=60`).then(
      (r) => live && setItems(r.data),
      (err) => live && (setError(err), setItems([])),
    );
    return () => {
      live = false;
    };
  }, [open, items, base]);

  async function use(a: AssetLite) {
    setBusy(a.id);
    setError(null);
    try {
      await api(`${base}/assets/${a.id}/attach`, { body: { scopeType, scopeId } });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="glass" className={className}>
          <ImageIcon aria-hidden />
          {label ?? t("assets.picker.button")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("assets.picker.title")} description={t("assets.picker.description")} closeLabel={t("common.close")} className="max-w-2xl">
        <div className="flex justify-end">
          <GenerateArtworkDialog organizationId={organizationId} companyId={companyId} connected={connected} defaultScope={{ type: scopeType, id: scopeId }} onCreated={() => setItems(null)} trigger={<Button size="sm">{t("assets.picker.generateNew")}</Button>} />
        </div>
        {items === null ? (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className="shimmer aspect-square rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("assets.picker.empty")}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {items.map((a) => {
              const current = a.scopeType === scopeType && a.scopeId === scopeId && a.pinned;
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => use(a)} disabled={!!busy} aria-label={`${t("assets.picker.use")}: ${a.title ?? a.prompt ?? t("assets.untitled")}`} className={cn("relative block w-full overflow-hidden rounded-xl focus-visible:outline-2", current && "ring-2 ring-primary", busy === a.id && "opacity-60")}>
                    <AssetThumb src={assetFileUrl(organizationId, companyId, a.id)} alt="" ratio="1:1" sizes="12rem" />
                    {current ? (
                      <span className="absolute end-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3.5" aria-hidden />
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <FormError error={error} />
      </DialogContent>
    </Dialog>
  );
}
