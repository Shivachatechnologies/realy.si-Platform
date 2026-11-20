import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { env } from "@/server/core/env";
import { API_REFERENCE } from "@/server/modules/enterprise/api-reference";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("enterprise.api.title") };
}

const METHOD_TONE = {
  GET: "neutral",
  POST: "success",
  PUT: "accent",
  PATCH: "accent",
  DELETE: "danger",
} as const;

export default async function ApiReferencePage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { org, company } = await requireOrgContext(locale);
  const base = env().APP_URL;
  const sample = `curl -H "Authorization: Bearer rly_XXXXXXXXXX_…" \\\n  ${base}/api/v1/organizations/${org.id}/companies${company ? `/${company.id}/enterprise/profile` : ""}`;
  return (
    <div className="grid gap-4">
      <Link href={`/${locale}/settings/developers`} className="text-sm text-muted-foreground hover:underline">
        ← {t("enterprise.api.back")}
      </Link>
      <Card>
        <CardHeader title={t("enterprise.api.title")} description={t("enterprise.api.subtitle")} />
        <CardBody className="grid gap-3 text-sm">
          <h3 className="font-medium">{t("enterprise.api.authTitle")}</h3>
          <p className="text-muted-foreground">{t("enterprise.api.auth")}</p>
          <pre dir="ltr" className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            {sample}
          </pre>
          <ul className="grid list-disc gap-1 ps-5 text-muted-foreground">
            <li>{t("enterprise.api.ruleScopes")}</li>
            <li>{t("enterprise.api.ruleErrors")}</li>
            <li>{t("enterprise.api.ruleIdempotency")}</li>
            <li>{t("enterprise.api.ruleRateLimits")}</li>
            <li>{t("enterprise.api.ruleIp")}</li>
          </ul>
          <p className="font-mono text-xs text-muted-foreground" dir="ltr">
            orgId = {org.id}
            {company ? ` · companyId = ${company.id}` : ""}
          </p>
        </CardBody>
      </Card>
      {API_REFERENCE.map((g) => (
        <Card key={g.group}>
          <CardHeader title={t(`enterprise.api.groups.${g.group}`)} />
          <ul className="divide-y">
            {g.endpoints.map((e) => (
              <li key={e.id} className="grid gap-1 px-4 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2" dir="ltr">
                  <Badge tone={METHOD_TONE[e.method]} className="font-mono">
                    {e.method}
                  </Badge>
                  <code className="text-xs break-all">{e.path}</code>
                </div>
                <p className="text-muted-foreground">{t(`enterprise.api.endpoints.${e.id}`)}</p>
                <p className="text-xs text-muted-foreground">
                  {t("enterprise.api.requires")} <code>{e.permission}</code>
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
