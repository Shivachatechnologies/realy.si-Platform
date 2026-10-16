import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { AGENT_PROFILES } from "@/server/modules/agents/profiles";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.workforce.title") };
}

export default async function WorkforcePage() {
  const locale = await getLocale();
  const t = await getT(locale);
  await requireOrgContext(locale);

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      <div className="grid gap-1">
        <h1 className="text-lg font-semibold tracking-tight">{t("modules.workforce.title")}</h1>
        <p className="text-muted-foreground">{t("workforce.subtitle")}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {AGENT_PROFILES.map((p) => (
          <Card key={p.key} className="flex flex-col">
            <CardHeader title={t(`profiles.${p.key}.name`)} description={t(`profiles.${p.key}.summary`)} />
            <CardBody className="grid flex-1 content-start gap-3 text-sm">
              <div className="grid gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Wrench aria-hidden className="size-3.5" />
                  {t("workforce.tools")}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {p.tools.map((tool) => (
                    <Badge key={tool}>{t(`workforce.toolNames.${tool}`)}</Badge>
                  ))}
                </div>
              </div>
              <p className="flex gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {t("workforce.noActions")} {t("workforce.limits", { turns: p.maxTurns })}
                </span>
              </p>
            </CardBody>
            <div className="border-t p-3">
              <Button asChild size="sm" variant="secondary">
                <Link href={`/${locale}/tasks?profile=${p.key}`}>{t("workforce.assign")}</Link>
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
