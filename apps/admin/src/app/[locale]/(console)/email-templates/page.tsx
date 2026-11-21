import Link from "next/link";
import { Mail, MailWarning } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, guard } from "@/components/admin/kit";
import { getLocale, getT } from "@/i18n/server";
import { listEmailTemplates } from "@/server/modules/cms/email-templates";
import { requireViewer } from "@/server/session";

/** Platform transactional email templates per locale (published template overrides the built-in text). */
export default async function AdminEmailTemplatesPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(listEmailTemplates(viewer.ctx), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const o = r.value;
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<Mail />} title={t("admin.nav.emailTemplates")} description={t("admin.emailTemplates.subtitle")} why={t("admin.emailTemplates.why")} />
      {!o.configured ? <Notice tone="warning">{t("admin.emailTemplates.notConfigured")}</Notice> : null}
      <Card>
        <Table>
          <THead>
            <Tr>
              <Th>{t("admin.emailTemplates.template")}</Th>
              <Th>{t("admin.emailTemplates.variables")}</Th>
              {o.templates[0]?.locales.map((l) => (
                <Th key={l.locale} className="font-mono">
                  {l.locale}
                </Th>
              ))}
            </Tr>
          </THead>
          <TBody>
            {o.templates.map((tpl) => (
              <Tr key={tpl.key}>
                <Td>
                  <div className="font-medium">{t(`admin.emailTemplates.keys.${tpl.key.replace(".", "_")}`)}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{tpl.key}</div>
                </Td>
                <Td className="font-mono text-[11px] text-muted-foreground">{tpl.vars.join(", ")}</Td>
                {tpl.locales.map((l) => (
                  <Td key={l.locale}>
                    <Link href={`/${locale}/email-templates/${encodeURIComponent(tpl.key)}/${l.locale}`} className="inline-flex focus-visible:outline-2">
                      {l.published ? (
                        <Badge tone={l.dirty ? "warning" : "success"}>{l.dirty ? t("admin.emailTemplates.changed") : `v${l.version}`}</Badge>
                      ) : l.exists ? (
                        <Badge tone="info">{t("admin.emailTemplates.draft")}</Badge>
                      ) : (
                        <Badge>{t("admin.emailTemplates.builtIn")}</Badge>
                      )}
                    </Link>
                  </Td>
                ))}
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MailWarning className="size-3.5" aria-hidden />
        {t("admin.emailTemplates.hookNote")}
      </p>
    </div>
  );
}
