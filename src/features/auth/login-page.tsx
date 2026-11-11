import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";

import { signInSchema } from "@shared/profile.ts";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { useAppConfig } from "@/features/profile/queries";
import { authClient } from "@/lib/auth-client";
import { useI18n } from "@/lib/i18n";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useSafeNext, withNext } from "@/lib/use-safe-next";

import { AuthCard, authLinkClass } from "./auth-card";
import { TwoFactorForm } from "./two-factor-form";
import { useFormErrors } from "./use-form-errors";
import { isCaptchaError, useTurnstile } from "./use-turnstile";

export function LoginPage() {
  const { t } = useI18n();
  useDocumentTitle(t("auth.signIn"));
  const navigate = useNavigate();
  const next = useSafeNext();
  const config = useAppConfig();
  const captcha = useTurnstile();
  const { errors, validate } = useFormErrors(signInSchema);
  const [formError, setFormError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setUnverified(null);
    const values = validate(Object.fromEntries(new FormData(event.currentTarget)));
    if (!values) return;

    setSubmitting(true);
    // Unverified accounts get a fresh link instead of a session; it lands on /verify-email.
    const { data, error } = await authClient.signIn.email({
      ...values,
      callbackURL: withNext("/verify-email", next),
      fetchOptions: captcha.fetchOptions,
    });
    setSubmitting(false);
    captcha.reset();

    if (isCaptchaError(error)) {
      setFormError(t("auth.captchaFailed"));
      return;
    }
    if (error?.status === 403) {
      setUnverified(values.email);
      return;
    }
    if (error) {
      setFormError(
        error.status === 401 ? t("auth.signInMismatch") : (error.message ?? t("auth.signInFailed")),
      );
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      setNeedsCode(true);
      return;
    }
    navigate(next, { replace: true });
  }

  if (needsCode) {
    return (
      <AuthCard title={t("auth.twoFactorTitle")}>
        <TwoFactorForm onSuccess={() => navigate(next, { replace: true })} />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t("auth.welcomeBack")}
      description={t("auth.signInDescription")}
      footer={
        config.data?.signUpEnabled && (
          <>
            {t("auth.newHere")}{" "}
            <Link to={withNext("/register", next)} className={authLinkClass}>
              {t("auth.createAnAccount")}
            </Link>
          </>
        )
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <FormMessage>{formError}</FormMessage>
        <FormMessage tone="success">
          {unverified && t("auth.verifyBeforeSignIn", { email: unverified })}
        </FormMessage>
        <Input
          label={t("common.email")}
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t("common.emailPlaceholder")}
          dir="ltr"
          error={errors.email}
          required
        />
        <div className="flex flex-col gap-1.5">
          <Input
            label={t("common.password")}
            name="password"
            type="password"
            autoComplete="current-password"
            error={errors.password}
            required
          />
          <Link
            to="/forgot-password"
            className="self-end text-xs font-medium text-accent hover:text-accent-hover"
          >
            {t("auth.forgotPassword")}
          </Link>
        </div>
        {captcha.widget}
        <Button type="submit" size="lg" className="mt-2" disabled={submitting}>
          {submitting ? t("auth.signingIn") : t("auth.signIn")}
        </Button>
      </form>
    </AuthCard>
  );
}
