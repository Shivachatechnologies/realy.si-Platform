import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Empty, guard } from "@/components/admin/kit";
import { ControlListEditor, ControlSwitch, ControlValueEditor, LockdownControl } from "@/components/admin/control-editors";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { CONTROL_DEFS, PLATFORM_MODULES, type ControlKey } from "@/server/core/platform-controls";
import { canPlatform } from "@/server/modules/admin/access";
import { listControls, settingRows } from "@/server/modules/admin/controls";
import { PROVIDERS } from "@/server/modules/integrations/catalog";
import { requireViewer } from "@/server/session";

const EMERGENCY: ControlKey[] = ["maintenanceMode", "readOnlyMode"];
const KILL: ControlKey[] = ["aiWorkforceEnabled", "aiExecutionPaused", "registrationsEnabled", "companyCreationEnabled", "automationsEnabled", "backgroundJobsPaused"];

/** Platform Controls: global kill switches with real enforcement, reasons, typed confirmation and audit. */
export default async function PlatformControlsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(listControls(viewer.ctx), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const { controls } = r.value;
  const [canManage, rows] = await Promise.all([canPlatform(viewer.ctx, "platform.controls.manage"), settingRows()]);
  const actors = await db().user.findMany({ where: { id: { in: [...new Set(rows.map((x) => x.updatedById).filter((x): x is string => !!x))] } }, select: { id: true, email: true } });
  const lockdown = controls.lockdown;
  const sw = (key: ControlKey) => (
    <ControlSwitch
      key={key}
      controlKey={key}
      value={controls[key] as boolean}
      normal={CONTROL_DEFS[key].default as boolean}
      critical={CONTROL_DEFS[key].critical}
      canManage={canManage}
      locked={!!lockdown && key in { maintenanceMode: 1, aiWorkforceEnabled: 1, backgroundJobsPaused: 1 }}
      label={t(`admin.controls.keys.${key}.label`)}
      description={t(`admin.controls.keys.${key}.hint`)}
    />
  );
  const moduleLabels = Object.fromEntries(PLATFORM_MODULES.map((m) => [m, t(`admin.modules.${m}`)]));
  return (
    <div className="grid gap-4">
      <AdminHeader title={t("admin.nav.controls")} description={t("admin.controls.subtitle")} />
      {!canManage ? <Notice tone="info">{t("admin.controls.readOnlyNotice")}</Notice> : null}
      <Card className={lockdown ? "border-danger/50" : undefined}>
        <CardHeader
          title={t("admin.controls.lockdown.title")}
          description={lockdown ? t("admin.controls.lockdown.activeSince", { date: formatDateTime(lockdown.startedAt, locale, viewer.user.timezone), sessions: lockdown.revokedSessions }) : t("admin.controls.lockdown.hint")}
          actions={<LockdownControl active={!!lockdown} canManage={canManage} />}
        />
        {lockdown ? <p className="px-4 py-2 text-sm">{lockdown.reason}</p> : null}
      </Card>
      <Card>
        <CardHeader title={t("admin.controls.groups.emergency")} />
        <div className="divide-y">
          {EMERGENCY.map(sw)}
          <ControlValueEditor controlKey="maintenanceMessage" kind="text" value={controls.maintenanceMessage} canManage={canManage} label={t("admin.controls.keys.maintenanceMessage.label")} description={t("admin.controls.keys.maintenanceMessage.hint")} />
        </div>
      </Card>
      <Card>
        <CardHeader title={t("admin.controls.groups.kill")} />
        <div className="divide-y">{KILL.map(sw)}</div>
      </Card>
      <Card>
        <CardHeader title={t("admin.controls.groups.modules")} />
        <div className="divide-y">
          <ControlListEditor controlKey="disabledModules" value={controls.disabledModules} options={[...PLATFORM_MODULES]} optionLabel={moduleLabels} canManage={canManage} label={t("admin.controls.keys.disabledModules.label")} description={t("admin.controls.keys.disabledModules.hint")} />
          <ControlListEditor
            controlKey="disabledIntegrations"
            value={controls.disabledIntegrations}
            options={PROVIDERS.map((p) => p.key)}
            optionLabel={Object.fromEntries(PROVIDERS.map((p) => [p.key, p.name]))}
            allowCustom
            canManage={canManage}
            label={t("admin.controls.keys.disabledIntegrations.label")}
            description={t("admin.controls.keys.disabledIntegrations.hint")}
          />
        </div>
      </Card>
      <Card>
        <CardHeader title={t("admin.controls.history")} />
        {rows.length === 0 ? (
          <Empty>{t("admin.controls.noChanges")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.controls.control")}</Th>
                <Th>{t("admin.controls.value")}</Th>
                <Th>{t("admin.audit.actor")}</Th>
                <Th>{t("admin.audit.reason")}</Th>
                <Th>{t("admin.audit.time")}</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((row) => (
                <Tr key={row.key}>
                  <Td className="font-mono text-xs">{row.key}</Td>
                  <Td>
                    <Badge>{JSON.stringify(row.value).slice(0, 80)}</Badge>
                  </Td>
                  <Td className="text-xs">{actors.find((a) => a.id === row.updatedById)?.email ?? "—"}</Td>
                  <Td className="max-w-72 truncate text-xs">{row.reason ?? ""}</Td>
                  <Td className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(row.updatedAt, locale, viewer.user.timezone)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
