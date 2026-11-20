import type { Metadata } from "next";
import { Card, CardHeader } from "@/components/ui/card";
import { BrandKitForm } from "@/components/marketing/brand-form";
import { MarketingShell, loadMarketing } from "@/components/marketing/shell";
import { ActionButton } from "@/components/marketing/ui";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { brandContext, getBrandKit } from "@/server/modules/marketing/brand";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.brand") };
}

export default async function BrandPage() {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "brand" as const, title: t("marketing.brand.title"), subtitle: t("marketing.brand.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage, tz } = m;
  const kit = await getBrandKit(viewer.ctx, org.id, company.id);
  const primary = kit?.colors[0]?.hex;

  return (
    <MarketingShell
      {...shell}
      actions={
        canManage && kit ? <ActionButton path={`${base}/brand`} method="DELETE" variant="ghost" label={t("marketing.brand.delete")} confirm={t("marketing.brand.confirmDelete")} /> : null
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Card>
          <CardHeader title={t("marketing.brand.kit")} description={kit ? t("marketing.brand.updated", { when: formatDateTime(kit.updatedAt, locale, tz) }) : t("marketing.brand.empty")} />
          {canManage ? (
            <BrandKitForm
              base={base}
              exists={!!kit}
              initial={{
                brandName: kit?.brandName ?? company.name,
                tagline: kit?.tagline ?? "",
                voiceTone: kit?.voiceTone ?? "",
                messagingPillars: kit?.messagingPillars.join("\n") ?? "",
                doWords: kit?.doWords.join(", ") ?? "",
                dontWords: kit?.dontWords.join(", ") ?? "",
                personas: kit?.personas ?? [],
                colors: kit?.colors ?? [],
                logoUrl: kit?.logoUrl ?? "",
                logoDarkUrl: kit?.logoDarkUrl ?? "",
                iconUrl: kit?.iconUrl ?? "",
                headingFont: kit?.headingFont ?? "",
                bodyFont: kit?.bodyFont ?? "",
              }}
            />
          ) : kit ? (
            <dl className="grid gap-3 p-4 text-sm sm:grid-cols-2">
              {(
                [
                  ["brandName", kit.brandName],
                  ["tagline", kit.tagline],
                  ["voiceTone", kit.voiceTone],
                  ["pillars", kit.messagingPillars.join(" · ")],
                  ["doWords", kit.doWords.join(", ")],
                  ["dontWords", kit.dontWords.join(", ")],
                  ["personas", kit.personas.map((p) => `${p.name}${p.description ? ` — ${p.description}` : ""}`).join("\n")],
                  ["headingFont", [kit.headingFont, kit.bodyFont].filter(Boolean).join(" / ")],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="grid gap-0.5">
                  <dt className="text-xs text-muted-foreground">{t(`marketing.brand.${k}`)}</dt>
                  <dd className="whitespace-pre-wrap">{v || "—"}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("marketing.brand.emptyReadOnly")}</p>
          )}
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("marketing.brand.preview")} />
            {kit ? (
              <div className="grid gap-3 p-4">
                <div className="grid gap-2 rounded-md border p-4" style={{ borderTopColor: primary, borderTopWidth: primary ? 4 : undefined }}>
                  {kit.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={kit.logoUrl} alt={kit.brandName} className="max-h-10 max-w-48 object-contain" />
                  ) : (
                    <strong style={{ color: primary, fontFamily: kit.headingFont ?? undefined }}>{kit.brandName}</strong>
                  )}
                  {kit.tagline ? <p className="text-sm text-muted-foreground" style={{ fontFamily: kit.bodyFont ?? undefined }}>{kit.tagline}</p> : null}
                </div>
                {kit.colors.length ? (
                  <ul className="flex flex-wrap gap-2">
                    {kit.colors.map((c) => (
                      <li key={`${c.name}-${c.hex}`} className="flex items-center gap-1.5 text-xs">
                        <span className="inline-block size-5 rounded border" style={{ backgroundColor: c.hex }} aria-hidden />
                        {c.name} <span className="font-mono text-muted-foreground">{c.hex}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("marketing.brand.empty")}</p>
            )}
          </Card>
          <Card>
            <CardHeader title={t("marketing.brand.aiContext")} description={t("marketing.brand.aiContextHint")} />
            {kit ? <pre className="overflow-x-auto whitespace-pre-wrap p-4 text-xs">{brandContext(kit)}</pre> : <p className="p-4 text-sm text-muted-foreground">{t("marketing.brand.empty")}</p>}
          </Card>
        </div>
      </div>
    </MarketingShell>
  );
}
