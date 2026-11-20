import Link from "next/link";
import { Mail } from "lucide-react";
import { AdminHeader, guard } from "@/components/admin/kit";
import { EmailTemplateEditor } from "@/components/admin/email-template-editor";
import { getLocale, getT } from "@/i18n/server";
import { canPlatform } from "@/server/modules/admin/access";
import { getEmailTemplate, sampleVars } from "@/server/modules/cms/email-templates";
import { requireViewer } from "@/server/session";

export default async function AdminEmailTemplatePage({ params }: PageProps<"/[locale]/email-templates/[key]/[tplLocale]">) {
  const uiLocale = await getLocale();
  const t = await getT(uiLocale);
  const viewer = await requireViewer(uiLocale);
  const p = await params;
  const key = decodeURIComponent(p.key);
  const tplLocale = p.tplLocale;
  const r = await guard(Promise.all([getEmailTemplate(viewer.ctx, key, tplLocale), canPlatform(viewer.ctx, "platform.content.manage")]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [tpl, canManage] = r.value;
  return (
    <div className="grid gap-4">
      <AdminHeader
        icon={<Mail />}
        eyebrow={
          <Link href={`/${uiLocale}/email-templates`} className="hover:underline">
            {t("admin.nav.emailTemplates")}
          </Link>
        }
        title={`${t(`admin.emailTemplates.keys.${tpl.key.replace(".", "_")}`)} · ${tpl.locale}`}
        description={tpl.publishedAt ? t("admin.emailTemplates.publishedVersion", { version: tpl.version }) : t("admin.emailTemplates.usingBuiltIn")}
      />
      <EmailTemplateEditor
        key={`${tpl.version}-${tpl.status}`}
        templateKey={tpl.key}
        locale={tpl.locale}
        initial={{ subject: tpl.subject, body: tpl.body }}
        vars={[...tpl.vars]}
        sample={sampleVars(tpl.key)}
        published={!!tpl.publishedBody}
        configured={tpl.configured}
        canManage={canManage}
      />
    </div>
  );
}
