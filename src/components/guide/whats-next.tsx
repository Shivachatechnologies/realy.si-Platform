import Link from "next/link";
import { ArrowRight, Compass, Sparkles } from "lucide-react";
import { AiCore } from "@/components/motion";
import { Card, CardHeader } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { whatsNext } from "@/server/modules/guide/service";
import { cn } from "@/lib/utils";
import { moduleStyle } from "./module-style";
import { activeScope } from "./scope-server";

/**
 * Command Center card: the top recommended actions across the company, from real counts (unfinished onboarding
 * first). Server Component — mount anywhere: <WhatsNext /> (optionally limit={3}).
 */
export async function WhatsNext({ limit = 3, className }: { limit?: number; className?: string }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { orgId, companyId, viewer } = await activeScope();
  if (!orgId || !companyId) return null;
  const data = await whatsNext(viewer.ctx, orgId, companyId, limit).catch(() => null);
  if (!data) return null;
  return (
    <Card variant="glass" className={cn("overflow-hidden", className)}>
      <CardHeader icon={<Compass />} title={t("guide.whatsNext.title")} description={t("guide.whatsNext.subtitle")} />
      {data.recommendations.length === 0 ? (
        <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
          <AiCore className="size-14" />
          {t("guide.whatsNext.allClear")}
        </div>
      ) : (
        <ol className="grid gap-px bg-border stagger">
          {data.recommendations.map((r, i) => {
            const style = moduleStyle(r.module);
            const Icon = style.icon;
            return (
              <li key={r.key} className="flex items-start gap-3 bg-surface p-4">
                <span aria-hidden className={cn("grid size-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br", style.ring)}>
                  <Icon className={cn("size-4", style.tone)} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    <span className="sr-only">{i + 1}. </span>
                    {t(`guide.recs.${r.key}.title`, { count: r.count ?? 0 })}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t(`guide.recs.${r.key}.why`)}</p>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold">
                    <Link href={`/${locale}${r.href}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                      {t("guide.go")}
                      <ArrowRight className="size-3 rtl:rotate-180" aria-hidden />
                    </Link>
                    <Link href={`/${locale}/command?q=${encodeURIComponent(t(`guide.command.suggest.${r.key}`))}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary">
                      <Sparkles className="size-3" aria-hidden />
                      {t("guide.whatsNext.askAi")}
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
