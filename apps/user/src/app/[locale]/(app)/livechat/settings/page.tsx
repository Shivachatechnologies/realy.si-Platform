import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Boxes, CircleCheck, CircleDashed, FileText } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { livechatPage } from "@/components/livechat/context";
import { LivechatSettingsForm } from "@/components/livechat/settings-form";
import { getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { getLivechatSettings, embedSnippet } from "@/server/modules/livechat/settings";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("livechat.settings.title") };
}

export default async function LivechatSettingsPage() {
  const p = await livechatPage("settings");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, base, perms, aiReady, wrap } = p;
  const s = await getLivechatSettings(viewer.ctx, org.id, company.id);
  const scope = { organizationId: org.id, companyId: company.id };
  const [articles, docs, products] = await Promise.all([
    db().supportKbArticle.count({ where: { ...scope, status: "PUBLISHED" } }),
    db().brainDocument.count({ where: { ...scope, status: "READY", tags: { has: s.brainTag } } }),
    db().product.count({ where: { ...scope, archivedAt: null, status: "ACTIVE" } }),
  ]);
  const knowledge = [
    { key: "facts", ok: !!s.publicFacts?.trim(), icon: FileText, count: null, href: null },
    { key: "articles", ok: articles > 0, icon: BookOpen, count: articles, href: `/${locale}/support/knowledge` },
    { key: "documents", ok: docs > 0, icon: FileText, count: docs, href: `/${locale}/brain` },
    { key: "products", ok: products > 0, icon: Boxes, count: products, href: `/${locale}/products` },
  ] as const;
  const anyKnowledge = knowledge.some((k) => k.ok);
  return wrap(
    <>
      {!perms.manage ? <Notice tone="info">{t("livechat.settings.readOnly")}</Notice> : null}
      {!aiReady ? <Notice tone="warning" title={t("livechat.aiMissingTitle")}>{t("livechat.aiMissingBody")}</Notice> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <LivechatSettingsForm
          base={base}
          canManage={perms.manage}
          snippet={embedSnippet(s.publicKey)}
          initial={{
            enabled: s.enabled,
            publicKey: s.publicKey,
            allowedOrigins: s.allowedOrigins,
            brandColor: s.brandColor,
            position: s.position,
            assistantName: s.assistantName,
            greeting: s.greeting,
            aiEnabled: s.aiEnabled,
            brainTag: s.brainTag,
            publicFacts: s.publicFacts,
            autoCreateLeads: s.autoCreateLeads,
            autoCreateTickets: s.autoCreateTickets,
            meetingsEnabled: s.meetingsEnabled,
            privacyUrl: s.privacyUrl,
            retentionDays: s.retentionDays,
          }}
        />
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("livechat.knowledge.title")} description={t("livechat.knowledge.hint")} />
            <CardBody>
              <ul className="grid gap-3">
                {knowledge.map((k) => (
                  <li key={k.key} className="flex items-start gap-2 text-sm">
                    {k.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
                    <span className="grid gap-0.5">
                      <span>
                        {t(`livechat.knowledge.${k.key}`, { count: k.count ?? 0, tag: s.brainTag })}
                        <span className="sr-only">{k.ok ? t("livechat.knowledge.ready") : t("livechat.knowledge.missing")}</span>
                      </span>
                      {k.href ? (
                        <Link href={k.href} className="text-xs underline">
                          {t(`livechat.knowledge.${k.key}Link`)}
                        </Link>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              {!anyKnowledge ? <Notice tone="warning" className="mt-3">{t("livechat.knowledge.none")}</Notice> : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("livechat.trust.title")} />
            <CardBody>
              <ul className="grid list-disc gap-1.5 ps-4 text-sm text-muted-foreground">
                {(["disclosure", "grounded", "consent", "approvals", "retention"] as const).map((k) => (
                  <li key={k}>{t(`livechat.trust.${k}`)}</li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </>,
  );
}
