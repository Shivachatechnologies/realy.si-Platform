"use client";

import { ExternalLink, PlugZap, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "@/components/automation/use-action";

/**
 * The only integration controls of the user app (docs/integrations.md "Who manages what"): sign in to your OWN account
 * with Realy's OAuth app, or disconnect it. API keys, credentials and connection settings are managed by Realy in the
 * Control Center and never entered here.
 */

/** "Connect with <provider>" (OAuth) — a top-level navigation to the start route, which redirects to the provider. */
export function OAuthConnectButton({ provider, name, orgId, companyId, locale, reconnect }: { provider: string; name: string; orgId: string; companyId: string; locale: string; reconnect?: boolean }) {
  const t = useT();
  const href = `/api/v1/integrations/oauth/${provider}/start?${new URLSearchParams({ orgId, companyId, locale })}`;
  return (
    <Button asChild variant={reconnect ? "secondary" : "default"}>
      <a href={href}>
        <PlugZap aria-hidden />
        {reconnect ? t("integrations.reconnect") : t("integrations.connectWith", { name })}
      </a>
    </Button>
  );
}

/** Disconnect an account the customer connected with OAuth (revokes the token at the provider where supported). */
export function DisconnectButton({ base, provider }: { base: string; provider: string }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const disconnect = () => {
    if (!confirm(t("integrations.disconnectConfirm"))) return;
    void run(() => api(`${base}/integrations/${provider}`, { method: "DELETE" }));
  };
  return (
    <div className="grid gap-2">
      <div>
        <Button type="button" variant="danger" disabled={busy} onClick={disconnect}>
          <Unplug aria-hidden />
          {t("integrations.disconnect")}
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}

export function DocsLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
      {label}
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
}
