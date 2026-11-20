"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api, ApiError, setCookie } from "@/lib/api-client";
import { takeFragmentToken } from "@/lib/safe-next";

export function ForgotPasswordForm() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<"configured" | "not_configured" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await api<{ emailDelivery: "configured" | "not_configured" }>("/api/v1/auth/password/forgot", { body: { email } });
          setResult(r.emailDelivery);
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label={t("auth.email")} htmlFor="email">
        <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <FormError error={error} />
      {result === "configured" ? <Notice tone="success">{t("auth.resetSent")}</Notice> : null}
      {result === "not_configured" ? <Notice tone="warning">{t("auth.emailNotConfigured")}</Notice> : null}
      <Button type="submit" disabled={busy || !email}>
        {t("auth.sendResetLink")}
      </Button>
    </form>
  );
}

function useFragmentToken() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    // Read once after mount (the fragment is client-only), then strip it from the URL.
    const v = takeFragmentToken();
    queueMicrotask(() => setToken(v));
  }, []);
  return token;
}

export function ResetPasswordForm() {
  const { t, locale } = useI18n();
  const token = useFragmentToken();
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (token === null) return <Notice tone="danger">{t("auth.resetInvalid")}</Notice>;
  if (done) {
    return (
      <div className="grid gap-3">
        <Notice tone="success">{t("auth.resetDone")}</Notice>
        <Button asChild>
          <Link href={`/${locale}/sign-in`}>{t("auth.signIn")}</Link>
        </Button>
      </div>
    );
  }
  const invalid = error instanceof ApiError && error.code === "validation_error" && !error.fieldErrors().password;
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api("/api/v1/auth/password/reset", { body: { token, password } });
          setDone(true);
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label={t("auth.newPassword")} htmlFor="password" hint={t("auth.passwordHint")}>
        <Input id="password" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {invalid ? <Notice tone="danger">{t("auth.resetInvalid")}</Notice> : <FormError error={error} />}
      <Button type="submit" disabled={busy || !token || password.length < 12}>
        {t("auth.resetTitle")}
      </Button>
    </form>
  );
}

const VERIFY_KEY = "realy_verify_token";

/**
 * Confirm an email address. The link must be opened while signed in to the account it was sent for
 * (server-enforced); otherwise the token is kept in sessionStorage (this tab only) across sign-in.
 */
export function VerifyEmail() {
  const { t, locale } = useI18n();
  const fragment = useFragmentToken();
  const [state, setState] = useState<"pending" | "ok" | "invalid" | "sign_in">("pending");
  useEffect(() => {
    if (fragment === undefined) return;
    let token: string | null = fragment;
    try {
      if (fragment) sessionStorage.setItem(VERIFY_KEY, fragment);
      token = sessionStorage.getItem(VERIFY_KEY);
    } catch {}
    if (!token) {
      queueMicrotask(() => setState("invalid"));
      return;
    }
    const forget = () => {
      try {
        sessionStorage.removeItem(VERIFY_KEY);
      } catch {}
    };
    api("/api/v1/auth/email/verify", { body: { token } }).then(
      () => (forget(), setState("ok")),
      (err) => {
        const code = err instanceof ApiError ? err.code : "";
        if (code === "unauthenticated" || code === "mfa_required") return setState("sign_in");
        forget();
        setState("invalid");
      },
    );
  }, [fragment]);
  if (state === "pending") return <Notice>{t("common.loading")}</Notice>;
  if (state === "sign_in") {
    return (
      <div className="grid gap-3">
        <Notice>{t("auth.verifySignInFirst")}</Notice>
        <Button asChild>
          <Link href={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/verify-email`)}`}>{t("auth.signIn")}</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      {state === "ok" ? <Notice tone="success">{t("auth.verified")}</Notice> : <Notice tone="danger">{t("auth.verifyInvalid")}</Notice>}
      <Button asChild variant="secondary">
        <Link href={`/${locale}`}>{t("nav.commandCenter")}</Link>
      </Button>
    </div>
  );
}

const INVITE_KEY = "realy_invite_token";

/**
 * Accept an invitation. The token arrives in the URL fragment; it is kept in sessionStorage (this tab only)
 * while the invitee signs in or signs up, then exchanged once and discarded.
 */
export function AcceptInvitation() {
  const { t, locale } = useI18n();
  const fragment = useFragmentToken();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "done" | "invalid">("idle");
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (fragment === undefined) return;
    let stored: string | null = null;
    try {
      if (fragment) sessionStorage.setItem(INVITE_KEY, fragment);
      stored = sessionStorage.getItem(INVITE_KEY);
    } catch {
      stored = fragment;
    }
    queueMicrotask(() => setToken(stored));
    api("/api/v1/me").then(
      () => setSignedIn(true),
      () => setSignedIn(false),
    );
  }, [fragment]);

  if (token === null) return <Notice tone="danger">{t("invite.missingToken")}</Notice>;
  if (token === undefined || signedIn === null) return <Notice>{t("common.loading")}</Notice>;
  if (!signedIn) {
    const next = encodeURIComponent(`/${locale}/invite`);
    return (
      <div className="grid gap-3">
        <Notice>{t("invite.signInFirst")}</Notice>
        <Button asChild>
          <Link href={`/${locale}/sign-in?next=${next}`}>{t("auth.signIn")}</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href={`/${locale}/sign-up?next=${next}`}>{t("auth.signUp")}</Link>
        </Button>
      </div>
    );
  }
  if (state === "done") {
    return (
      <div className="grid gap-3">
        <Notice tone="success">{t("invite.accepted")}</Notice>
        <Button asChild>
          <Link href={`/${locale}`}>{t("nav.commandCenter")}</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      {state === "invalid" ? <Notice tone="danger">{t("invite.invalid")}</Notice> : <FormError error={error} />}
      <Button
        disabled={state === "busy" || state === "invalid"}
        onClick={async () => {
          setState("busy");
          setError(null);
          try {
            const r = await api<{ organizationId: string }>("/api/v1/invitations/accept", { body: { token } });
            setCookie("realy_org", r.organizationId);
            try {
              sessionStorage.removeItem(INVITE_KEY);
            } catch {}
            setState("done");
          } catch (err) {
            const code = err instanceof ApiError ? err.code : "";
            if (code === "not_found" || code === "forbidden") {
              try {
                sessionStorage.removeItem(INVITE_KEY);
              } catch {}
              setState("invalid");
            } else {
              setError(err);
              setState("idle");
            }
          }
        }}
      >
        {t("invite.accept")}
      </Button>
    </div>
  );
}
