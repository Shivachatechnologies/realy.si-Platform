import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { requireViewer } from "@/server/session";
import { platformGrants } from "@/server/workspace";

export default async function AdminOverviewPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const grants = await platformGrants(viewer.user.id);
  return (
    <Card>
      <CardHeader title={t("admin.yourAccess")} description={t("admin.overviewSubtitle")} />
      <Table>
        <THead>
          <Tr>
            <Th>{t("settings.members.role")}</Th>
            <Th>{t("admin.pricing.market")}</Th>
            <Th>{t("settings.members.permissions")}</Th>
          </Tr>
        </THead>
        <TBody>
          {grants.map((g) => (
            <Tr key={g.assignmentId}>
              <Td className="font-mono text-xs">{g.roleKey}</Td>
              <Td>
                <Badge tone="accent">{`${g.scopeType}:${g.scopeId}`}</Badge>
              </Td>
              <Td className="font-mono text-[11px] text-muted-foreground">{[...g.permissions].sort().join(" · ")}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}
