"use client";

import { Notice } from "@/components/ui/notice";
import { useT } from "@/i18n/client";
import { ApiError } from "@/lib/api-client";

/** Localized message for an API error code (the server's English message is for developers/logs). */
export function useErrorMessage() {
  const t = useT();
  return (err: unknown) => {
    const code = err instanceof ApiError ? err.code : "internal_error";
    const known = t(`errors.${code}`);
    return known === `errors.${code}` ? t("errors.internal_error") : known;
  };
}

export function FormError({ error }: { error: unknown }) {
  const message = useErrorMessage();
  if (!error) return null;
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <Notice tone="danger">
      {message(error)}
      {requestId ? <span className="ms-1 font-mono text-[11px] opacity-60">{requestId}</span> : null}
    </Notice>
  );
}
