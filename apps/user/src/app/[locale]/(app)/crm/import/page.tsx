import type { Metadata } from "next";
import { Download } from "lucide-react";
import { CsvImport } from "@/components/crm/import-export";
import { CrmFrame, crmContext } from "@/components/crm/shell";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.tabs.import") };
}

export default async function ImportExportPage() {
  const c = await crmContext();
  if (!c.company || !c.canRead) return <CrmFrame active="import">{null}</CrmFrame>;
  const { t, base } = c;
  return (
    <CrmFrame active="import" subtitle={t("crm.import.subtitle")}>
      <Card>
        <CardHeader title={t("crm.import.title")} description={t("crm.import.description")} />
        {c.canManage ? <CsvImport base={base} /> : <Notice tone="warning" className="m-4">{t("errors.forbidden")}</Notice>}
      </Card>
      <Card>
        <CardHeader title={t("crm.export.title")} description={t("crm.export.description")} />
        <CardBody className="flex flex-wrap gap-2">
          {(["leads", "contacts", "accounts", "deals"] as const).map((e) => (
            <Button key={e} asChild variant="secondary" size="sm">
              <a href={`${base}/crm/export/${e}`}>
                <Download aria-hidden />
                {t(`crm.import.entities.${e}`)}
              </a>
            </Button>
          ))}
        </CardBody>
      </Card>
    </CrmFrame>
  );
}
