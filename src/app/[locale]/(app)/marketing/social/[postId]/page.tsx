import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { PostActions, PostComposer } from "@/components/marketing/social-forms";
import { MarketingShell, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { ActionButton } from "@/components/marketing/ui";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { AppError } from "@/server/core/errors";
import { campaignOptions } from "@/server/modules/marketing/campaigns";
import { getPost, listAccounts } from "@/server/modules/marketing/social";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.social") };
}

export default async function SocialPostPage({ params }: PageProps<"/[locale]/marketing/social/[postId]">) {
  const { postId } = await params;
  const m = await loadMarketing();
  const { locale, t } = m;
  const back = { href: `/${locale}/marketing/social`, label: t("marketing.social.title") };
  if (m.blocked) return <MarketingShell locale={locale} t={t} tab="social" title={t("marketing.social.title")} back={back} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage, tz } = m;
  const { post: p, connected } = await getPost(viewer.ctx, org.id, company.id, postId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const editable = canManage && ["DRAFT", "SCHEDULED", "FAILED"].includes(p.status);
  const [accounts, campaigns] = editable ? await Promise.all([listAccounts(viewer.ctx, org.id, company.id), campaignOptions(viewer.ctx, org.id, company.id)]) : [null, []];
  const notConnected = p.targets.filter((x) => !connected[x.account.provider]);

  return (
    <MarketingShell
      locale={locale}
      t={t}
      tab="social"
      back={back}
      title={p.title}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={p.status} label={t(`marketing.postStatus.${p.status}`)} />
          {p.scheduledAt ? <span className="text-xs">{t("marketing.content.scheduledFor", { date: formatDateTime(p.scheduledAt, locale, tz) })}</span> : null}
          {p.campaign ? (
            <Link href={`/${locale}/marketing/campaigns/${p.campaign.id}`} className="text-xs hover:underline">
              · {p.campaign.name}
            </Link>
          ) : null}
          {p.content ? (
            <Link href={`/${locale}/marketing/content/${p.content.id}`} className="text-xs hover:underline">
              · {p.content.title}
            </Link>
          ) : null}
        </span>
      }
      actions={canManage && ["DRAFT", "CANCELLED", "FAILED"].includes(p.status) ? <ActionButton path={`${base}/social/posts/${p.id}`} method="DELETE" variant="ghost" label={t("marketing.common.delete")} confirm={t("marketing.common.confirmDelete")} redirectTo={back.href} /> : null}
    >
      <AutoRefresh active={p.status === "PUBLISHING"} />
      {notConnected.length && ["DRAFT", "SCHEDULED"].includes(p.status) ? (
        <Notice tone="warning">
          {t("marketing.social.willFail", { accounts: notConnected.map((x) => x.account.name).join(", ") })}{" "}
          <Link href={`/${locale}/integrations`} className="font-medium underline">
            {t("marketing.common.openIntegrations")}
          </Link>
        </Notice>
      ) : null}
      {canManage ? (
        <Card>
          <CardHeader title={t("marketing.social.publishing")} description={t("marketing.social.publishingHint")} />
          <PostActions base={base} postId={p.id} status={p.status} />
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("marketing.social.deliveries")} />
        <Table>
          <THead>
            <Tr>
              <Th>{t("marketing.social.account")}</Th>
              <Th>{t("common.status")}</Th>
              <Th>{t("marketing.social.text")}</Th>
              <Th className="text-end">{t("marketing.social.impressions")}</Th>
              <Th className="text-end">{t("marketing.social.likes")}</Th>
              <Th className="text-end">{t("marketing.social.comments")}</Th>
              <Th className="text-end">{t("marketing.social.shares")}</Th>
            </Tr>
          </THead>
          <TBody>
            {p.targets.map((x) => (
              <Tr key={x.id}>
                <Td>
                  <p className="font-medium">{x.account.name}</p>
                  <p className="text-xs text-muted-foreground">{t(`marketing.provider.${x.account.provider}`)}</p>
                </Td>
                <Td>
                  <div className="grid gap-1">
                    <StatusBadge status={x.status === "PENDING" ? "PENDING" : x.status} label={t(`marketing.targetStatus.${x.status}`)} />
                    {x.providerUrl ? (
                      <a href={x.providerUrl} target="_blank" rel="noopener noreferrer" className="text-xs hover:underline">
                        {t("marketing.social.viewOnPlatform")}
                      </a>
                    ) : null}
                    {x.error ? <span className="max-w-xs break-words text-xs text-danger">{x.error.startsWith("not_connected") ? t("marketing.social.errorNotConnected") : x.error}</span> : null}
                    {x.publishedAt ? <span className="text-xs text-muted-foreground">{formatDateTime(x.publishedAt, locale, tz)}</span> : null}
                  </div>
                </Td>
                <Td className="max-w-md">
                  <p className="line-clamp-3 whitespace-pre-wrap text-xs">{x.text ?? p.text}</p>
                </Td>
                <Td className="text-end tabular-nums">{x.impressions ?? "—"}</Td>
                <Td className="text-end tabular-nums">{x.likes ?? "—"}</Td>
                <Td className="text-end tabular-nums">{x.comments ?? "—"}</Td>
                <Td className="text-end tabular-nums">{x.shares ?? "—"}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        {p.targets.some((x) => x.metricsAt) ? (
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            {t("marketing.social.metricsAt", { date: formatDateTime(new Date(Math.max(...p.targets.map((x) => x.metricsAt?.getTime() ?? 0))), locale, tz) })}
          </p>
        ) : null}
      </Card>
      {p.targets.some((x) => x.snapshots.length > 1) ? (
        <Card>
          <CardHeader title={t("marketing.social.history")} />
          <ul className="grid divide-y text-xs">
            {p.targets.flatMap((x) =>
              x.snapshots.map((s) => (
                <li key={s.id} className="flex flex-wrap gap-3 px-4 py-1.5">
                  <span className="font-medium">{x.account.name}</span>
                  <span className="text-muted-foreground">{formatDateTime(s.capturedAt, locale, tz)}</span>
                  <span>
                    {t("marketing.social.likes")}: {s.likes ?? "—"} · {t("marketing.social.comments")}: {s.comments ?? "—"} · {t("marketing.social.shares")}: {s.shares ?? "—"} · {t("marketing.social.impressions")}: {s.impressions ?? "—"}
                  </span>
                </li>
              )),
            )}
          </ul>
        </Card>
      ) : null}
      {editable && accounts ? (
        <Card>
          <details>
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("marketing.social.editPost")}</summary>
            <PostComposer
              base={base}
              locale={locale}
              accounts={accounts.accounts.map((a) => ({ id: a.id, name: a.name, provider: a.provider, connected: a.connected }))}
              campaigns={campaigns}
              initial={{ id: p.id, title: p.title, text: p.text, mediaUrl: p.mediaUrl ?? "", campaignId: p.campaignId ?? "", targets: p.targets.map((x) => ({ accountId: x.accountId, text: x.text ?? "", custom: x.text != null })) }}
            />
          </details>
        </Card>
      ) : null}
    </MarketingShell>
  );
}
