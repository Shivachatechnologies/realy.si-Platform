import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Eye, ShieldAlert, Workflow } from "lucide-react";
import { World } from "@/components/ui/world";
import { AiAvatar } from "@/components/graphics/ai-avatar";
import { AiCoreStage } from "@/components/graphics/ai-core-stage";
import { SiteContainer, SiteHeading } from "@/components/site/section";
import { siteMetadata } from "@/components/site/meta";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { AGENT_PROFILES } from "@/server/modules/agents/profiles";
import { loadTools } from "@/server/modules/tools/registry";
import { PROFILE_DEPARTMENT_ORDER } from "@/server/modules/site/content";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getT(locale);
  return siteMetadata({ locale, path: "/ai-workforce", title: t("site.workforce.metaTitle"), description: t("site.workforce.lede", { count: AGENT_PROFILES.length }) });
}

/**
 * The AI workforce, read from the live role catalogue (agents/profiles.ts) and tool registry: every role, its department
 * and how many of its tools act on their own (reads) versus wait for a person (changes, external actions).
 */
export default async function WorkforcePage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const tools = await loadTools().catch(() => null);
  const roles = AGENT_PROFILES.map((p) => {
    const defs = tools ? p.tools.map((n) => tools[n]).filter((d) => !!d) : [];
    return {
      key: p.key,
      department: p.department ?? "general",
      tools: p.tools.length,
      auto: defs.filter((d) => d.autonomy === "AUTONOMOUS").length,
      supervised: defs.filter((d) => d.autonomy !== "AUTONOMOUS").length,
      external: defs.filter((d) => d.autonomy !== "AUTONOMOUS" && d.risk === "HIGH").length,
    };
  });
  const groups = PROFILE_DEPARTMENT_ORDER.map((dep) => ({ dep, roles: roles.filter((r) => r.department === dep) })).filter((g) => g.roles.length > 0);
  const depLabel = (dep: string) => (dep === "general" ? t("site.workforce.general") : t(`workforce.departments.${dep}`));
  const n = (v: number) => formatNumber(v, locale);

  return (
    <World name="automation" ambient={false}>
      <section className="relative overflow-hidden">
        <div aria-hidden className="site-hero-light pointer-events-none absolute inset-0 -z-10" />
        <SiteContainer className="grid items-center gap-10 pt-14 pb-16 sm:pt-20 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <SiteHeading as="h1" eyebrow={t("site.workforce.eyebrow")} title={t("site.workforce.title")} lede={t("site.workforce.lede", { count: roles.length })} />
          <div className="relative mx-auto aspect-square w-full max-w-xs">
            <AiCoreStage activity={0} nodes={Math.min(groups.length, 12)} className="size-full" />
          </div>
        </SiteContainer>
      </section>

      <section className="border-t py-16">
        <SiteContainer className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: Eye, title: t("site.home.ladder.read.title"), body: t("site.home.ladder.read.body") },
            { icon: Workflow, title: t("site.home.ladder.change.title"), body: t("site.home.ladder.change.body") },
            { icon: ShieldAlert, title: t("site.home.ladder.external.title"), body: t("site.home.ladder.external.body") },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="grid content-start gap-3 rounded-3xl border bg-surface p-6">
              <Icon className="size-5 text-primary" aria-hidden />
              <h2 className="text-[16px] font-semibold">{title}</h2>
              <p className="text-[14px] leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </SiteContainer>
      </section>

      <section className="border-t bg-muted/25 py-16 sm:py-20">
        <SiteContainer className="grid gap-14">
          <SiteHeading eyebrow={t("site.workforce.rosterEyebrow")} title={t("site.workforce.rosterTitle")} lede={t("site.workforce.rosterLede")} />
          {groups.map((g) => (
            <div key={g.dep} className="grid gap-5">
              <h3 className="flex items-baseline gap-3 border-b pb-3">
                <span className="font-display text-display-lg">{depLabel(g.dep)}</span>
                <span className="font-mono text-[12px] text-muted-foreground">{n(g.roles.length)}</span>
              </h3>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.roles.map((r) => (
                  <li key={r.key} className="grid content-start gap-3 rounded-2xl border bg-surface p-5">
                    <div className="flex items-center gap-3">
                      <AiAvatar seed={r.key} department={r.department} size={42} />
                      <p className="min-w-0 text-[15px] leading-tight font-semibold">{t(`profiles.${r.key}.name`)}</p>
                    </div>
                    <p className="text-[13.5px] leading-relaxed text-muted-foreground">{t(`profiles.${r.key}.summary`)}</p>
                    {tools ? (
                      <dl className="mt-auto flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-[12px] text-muted-foreground">
                        <div className="flex gap-1">
                          <dt>{t("site.workforce.autoTools")}</dt>
                          <dd className="tabular font-medium text-foreground">{n(r.auto)}</dd>
                        </div>
                        <div className="flex gap-1">
                          <dt>{t("site.workforce.approvalTools")}</dt>
                          <dd className="tabular font-medium text-foreground">{n(r.supervised)}</dd>
                        </div>
                        {r.external > 0 ? (
                          <div className="flex gap-1">
                            <dt>{t("site.workforce.externalTools")}</dt>
                            <dd className="tabular font-medium text-foreground">{n(r.external)}</dd>
                          </div>
                        ) : null}
                      </dl>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </SiteContainer>
      </section>

      <section className="border-t py-20">
        <SiteContainer className="grid justify-items-center gap-6 text-center">
          <h2 className="max-w-2xl font-display text-display-xl text-balance">{t("site.workforce.ctaTitle")}</h2>
          <p className="max-w-xl text-muted-foreground">{t("site.workforce.ctaLede")}</p>
          <Link href={`/${locale}/sign-up`} className="press inline-flex min-h-12 items-center gap-2 rounded-full bg-foreground px-6 text-[15px] font-medium text-background shadow-elev-3">
            {t("site.home.ctaPrimary")}
            <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </Link>
        </SiteContainer>
      </section>
    </World>
  );
}
