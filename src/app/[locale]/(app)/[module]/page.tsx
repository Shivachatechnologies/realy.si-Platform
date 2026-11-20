import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Construction } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { isModuleKey, MODULE_PHASE } from "@/components/shell/nav";
import { getLocale, getT } from "@/i18n/server";
import { requireOrgContext } from "@/server/workspace";

/** Realy Connect adapters planned for Phase 5 (docs/integrations.md §5). Brand names are data. */

export async function generateMetadata({ params }: PageProps<"/[locale]/[module]">): Promise<Metadata> {
  const { module } = await params;
  if (!isModuleKey(module)) return {};
  return { title: (await getT())(`modules.${module}.title`) };
}

/**
 * Modules from later roadmap phases. They are listed in navigation so the product's shape is visible,
 * but they render an explicit "not available yet" state — never simulated data.
 */
export default async function ModulePage({ params }: PageProps<"/[locale]/[module]">) {
  const { module } = await params;
  if (!isModuleKey(module)) notFound();
  const locale = await getLocale();
  const t = await getT(locale);
  await requireOrgContext(locale);
  const phase = MODULE_PHASE[module];

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <div className="flex items-start gap-3">
        <div className="grid gap-1">
          <h1 className="text-lg font-semibold tracking-tight">{t(`modules.${module}.title`)}</h1>
          <p className="text-muted-foreground">{t(`modules.${module}.description`)}</p>
        </div>
        <Badge tone="warning" className="ms-auto mt-1">{t("common.comingInPhase", { phase })}</Badge>
      </div>
      <Card>
        <CardBody className="flex items-start gap-3">
          <Construction className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">{t("modules.phaseNote", { phase })}</p>
        </CardBody>
      </Card>

    </div>
  );
}
