"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Pin, PinOff, Trash2, ArrowUpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import type { InstallSummary } from "@/server/modules/marketplace/install";
import type { ConfigKey } from "@/server/modules/marketplace/manifest";
import { InstallSummaryList } from "./install-summary";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run<R>(fn: () => Promise<R>, after?: (r: R) => void) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      after?.(r);
      router.refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export interface InstallPanelProps {
  base: string;
  listingKey: string;
  versions: { version: string; config: ConfigKey[] }[];
  workspaces: { id: string; name: string }[];
  companyName: string;
  baseCurrency: string;
  defaultFiscalMonth: number;
  canInstall: boolean;
  paid: boolean;
}

export function InstallPanel(p: InstallPanelProps) {
  const { t, locale } = useI18n();
  const [version, setVersion] = useState(p.versions[0]?.version ?? "");
  const [pinned, setPinned] = useState(false);
  const [workspaceId, setWorkspaceId] = useState(p.workspaces[0]?.id ?? "");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fiscal, setFiscal] = useState(p.defaultFiscalMonth);
  const [confirmCurrency, setConfirmCurrency] = useState(false);
  const [include, setInclude] = useState({
    includeRoles: true,
    includeProjects: true,
    includeObjectives: true,
  });
  const [result, setResult] = useState<{
    id: string;
    version: string;
    summary: InstallSummary;
  } | null>(null);
  const { busy, error, run } = useRun();
  const keys = new Set(p.versions.find((v) => v.version === version)?.config ?? []);
  const monthName = (m: number) => new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, m - 1, 1)));

  if (!p.canInstall) return <Notice tone="warning">{t("marketplace.install.noPermission")}</Notice>;
  if (p.paid) return <Notice tone="info">{t("marketplace.install.paidUnavailable")}</Notice>;
  if (result) {
    return (
      <div className="grid gap-3">
        <Notice tone="success">
          {t("marketplace.install.done", {
            version: result.version,
            company: p.companyName,
          })}
        </Notice>
        <InstallSummaryList summary={result.summary} />
        <Link href={`/${locale}/marketplace/installed#${result.id}`} className="text-sm text-primary hover:underline">
          {t("marketplace.install.viewInstalled")}
        </Link>
      </div>
    );
  }

  const config: Record<string, unknown> = {};
  if (keys.has("workspaceId") && workspaceId) config.workspaceId = workspaceId;
  if (keys.has("startDate") && startDate) config.startDate = startDate;
  if (keys.has("fiscalYearStartMonth")) config.fiscalYearStartMonth = fiscal;
  if (keys.has("confirmCurrency")) config.confirmCurrency = confirmCurrency;
  for (const k of ["includeRoles", "includeProjects", "includeObjectives"] as const) if (keys.has(k)) config[k] = include[k];

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () =>
            api<{ id: string; version: string; summary: InstallSummary }>(`${p.base}/marketplace/installations`, { body: { listingKey: p.listingKey, version, pinned, config } }),
          setResult,
        );
      }}
    >
      <p className="text-sm text-muted-foreground">{t("marketplace.install.into", { company: p.companyName })}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("marketplace.install.version")} htmlFor="mp-version">
          <Select id="mp-version" value={version} onChange={(e) => setVersion(e.target.value)}>
            {p.versions.map((v, i) => (
              <option key={v.version} value={v.version}>
                {i === 0 ? t("marketplace.install.latest", { version: v.version }) : v.version}
              </option>
            ))}
          </Select>
        </Field>
        {keys.has("workspaceId") ? (
          <Field label={t("marketplace.config.workspaceId")} htmlFor="mp-ws">
            <Select id="mp-ws" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
              {p.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {keys.has("startDate") ? (
          <Field label={t("marketplace.config.startDate")} htmlFor="mp-start" hint={t("marketplace.config.startDateHint")}>
            <Input id="mp-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
        ) : null}
        {keys.has("fiscalYearStartMonth") ? (
          <Field label={t("marketplace.config.fiscalYearStartMonth")} htmlFor="mp-fiscal">
            <Select id="mp-fiscal" value={fiscal} onChange={(e) => setFiscal(Number(e.target.value))}>
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      <div className="grid gap-2 text-sm">
        {keys.has("confirmCurrency") ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={confirmCurrency} onChange={(e) => setConfirmCurrency(e.target.checked)} />
            {t("marketplace.config.confirmCurrency", {
              currency: p.baseCurrency,
            })}
          </label>
        ) : null}
        {(["includeRoles", "includeProjects", "includeObjectives"] as const)
          .filter((k) => keys.has(k))
          .map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" checked={include[k]} onChange={(e) => setInclude((x) => ({ ...x, [k]: e.target.checked }))} />
              {t(`marketplace.config.${k}`)}
            </label>
          ))}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          {t("marketplace.install.pin")}
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{t("marketplace.install.idempotent")}</p>
      <FormError error={error} />
      <div>
        <Button type="submit" disabled={busy || !version}>
          <Download aria-hidden />
          {busy ? t("marketplace.install.installing") : t("marketplace.install.submit")}
        </Button>
      </div>
    </form>
  );
}

/** Upgrade / pin / uninstall for an active installation. */
export function InstallationActions({
  base,
  installation,
  newerVersions,
  canInstall,
}: {
  base: string;
  installation: { id: string; version: string; pinned: boolean };
  newerVersions: string[];
  canInstall: boolean;
}) {
  const t = useI18n().t;
  const [target, setTarget] = useState(newerVersions[0] ?? "");
  const [summary, setSummary] = useState<InstallSummary | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run } = useRun();
  const url = `${base}/marketplace/installations/${installation.id}`;
  if (!canInstall) return null;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {newerVersions.length ? (
          <>
            <Select aria-label={t("marketplace.install.version")} className="h-8 w-auto text-xs" value={target} onChange={(e) => setTarget(e.target.value)}>
              {newerVersions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              disabled={busy || !target}
              onClick={() =>
                void run(
                  () =>
                    api<{ summary: InstallSummary }>(`${url}/upgrade`, {
                      body: { version: target },
                    }),
                  (r) => setSummary(r.summary),
                )
              }
            >
              <ArrowUpCircle aria-hidden />
              {t("marketplace.install.upgrade")}
            </Button>
          </>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void run(() =>
              api(url, {
                method: "PATCH",
                body: { pinned: !installation.pinned },
              }),
            )
          }
        >
          {installation.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
          {installation.pinned
            ? t("marketplace.install.unpin")
            : t("marketplace.install.pinVersion", {
                version: installation.version,
              })}
        </Button>
        {confirming ? (
          <>
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={() =>
                void run(
                  () => api(url, { method: "DELETE" }),
                  () => setConfirming(false),
                )
              }
            >
              {t("marketplace.install.confirmUninstall")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
            <Trash2 aria-hidden />
            {t("marketplace.install.uninstall")}
          </Button>
        )}
      </div>
      {confirming ? <p className="text-xs text-muted-foreground">{t("marketplace.install.uninstallHint")}</p> : null}
      {summary ? <InstallSummaryList summary={summary} /> : null}
      <FormError error={error} />
    </div>
  );
}
