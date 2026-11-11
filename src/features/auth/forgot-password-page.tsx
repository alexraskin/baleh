import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { z } from "zod";

import { emailSchema } from "@shared/profile.ts";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { useI18n } from "@/lib/i18n";
import { useDocumentTitle } from "@/lib/use-document-title";

import { AuthCard, authLinkClass } from "./auth-card";
import { useFormErrors } from "./use-form-errors";
import { isCaptchaError, useTurnstile } from "./use-turnstile";

const schema = z.object({ email: emailSchema });

export function ForgotPasswordPage() {
  const { t } = useI18n();
  useDocumentTitle(t("auth.resetPassword"));
  const { errors, validate } = useFormErrors(schema);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const captcha = useTurnstile();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const values = validate(Object.fromEntries(new FormData(event.currentTarget)));
    if (!values) return;

    setSubmitting(true);
    const { error } = await authClient.requestPasswordReset({
      email: values.email,
      redirectTo: "/reset-password",
      fetchOptions: captcha.fetchOptions,
    });
    setSubmitting(false);
    captcha.reset();

    if (isCaptchaError(error)) setFormError(t("auth.captchaFailed"));
    else if (error) setFormError(error.message ?? t("auth.resetSendFailed"));
    else setSent(true);
  }

  const footer = (
    <Link to="/login" className={authLinkClass}>
      {t("auth.backToSignIn")}
    </Link>
  );

  return (
    <AuthCard title={t("auth.resetTitle")} description={t("auth.resetDescription")} footer={footer}>
      {sent ? (
        <FormMessage tone="success">{t("auth.resetSent")}</FormMessage>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <FormMessage>{formError}</FormMessage>
          <Input
            label={t("common.email")}
            name="email"
            type="email"
            autoComplete="email"
            dir="ltr"
            error={errors.email}
            required
          />
          {captcha.widget}
          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? t("auth.sending") : t("auth.sendResetLink")}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
