import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { DecideForm } from "@/components/briefing/decide-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { formatDateTime } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { peekDecisionToken } from "@/server/modules/briefing/service";
import { requireViewer } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("briefing.decide.title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

const RISK_TONE = { LOW: "neutral", MEDIUM: "info", HIGH: "warning", CRITICAL: "danger" } as const;

/** Landing page of a briefing decision link: shows the request and asks the signed-in recipient to confirm. */
export default async function BriefingDecidePage({ params, searchParams }: PageProps<"/[locale]/briefing/decide/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const peek = await peekDecisionToken(viewer.ctx, token);
  const initial = sp.d === "approve" || sp.d === "reject" ? sp.d : null;
  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <PageHeader variant="editorial" world="command" eyebrow={t("briefing.eyebrow")} title={t("briefing.decide.title")} illustration={false} />
      {peek.state === "invalid" || peek.state === "wrong_user" ? (
        <Notice tone="danger" title={t(`briefing.decide.state.${peek.state}`)}>
          <Link href={`/${locale}/approvals`} className="text-primary hover:underline">
            {t("briefing.decide.openApprovals")}
          </Link>
        </Notice>
      ) : (
        <Card variant="elevated">
          <CardBody className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-4 text-world" aria-hidden />
              <span className="numeral font-semibold text-world">#{peek.ref}</span>
              <Badge tone={RISK_TONE[peek.approval.risk as keyof typeof RISK_TONE] ?? "neutral"}>{t(`briefing.risk.${peek.approval.risk}`)}</Badge>
              <span>{t("briefing.view.expires", { date: formatDateTime(peek.approval.expiresAt, locale, viewer.user.timezone) })}</span>
            </div>
            <p className="font-display text-xl text-balance">{peek.approval.summary}</p>
            {peek.state === "ready" ? (
              <>
                {peek.approval.risk === "HIGH" || peek.approval.risk === "CRITICAL" || peek.approval.autonomy === "FOUNDER_ONLY" ? <Notice tone="warning">{t("briefing.decide.mfaHint")}</Notice> : null}
                <DecideForm apiBase={`/api/v1/organizations/${peek.organizationId}/companies/${peek.companyId}`} token={token} initial={initial} />
              </>
            ) : (
              <Notice tone={peek.state === "used" ? "success" : "info"} title={t(`briefing.decide.state.${peek.state}`)}>
                <Link href={`/${locale}/briefing/${peek.reportId}`} className="text-primary hover:underline">
                  {t("briefing.decide.openBriefing")}
                </Link>
              </Notice>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
