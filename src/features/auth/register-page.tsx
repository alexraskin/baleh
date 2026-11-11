import { useState, type FormEvent } from "react";
import { Link } from "react-router";

import { signUpSchema } from "@shared/profile.ts";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { useAppConfig } from "@/features/profile/queries";
import { languageCodes, languages, type LanguageCode } from "@/config/i18n";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useSafeNext, withNext } from "@/lib/use-safe-next";

import { AuthCard, authLinkClass } from "./auth-card";
import { useFormErrors } from "./use-form-errors";
import { isCaptchaError, useTurnstile } from "./use-turnstile";

export function RegisterPage() {
  const { t, language: interfaceLanguage } = useI18n();
  useDocumentTitle(t("auth.createAccount"));
  const next = useSafeNext();
  const { errors, validate } = useFormErrors(signUpSchema);
  const [language, setLanguage] = useState<LanguageCode>(interfaceLanguage);
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const config = useAppConfig();
  const captcha = useTurnstile();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const form = Object.fromEntries(new FormData(event.currentTarget));
    const values = validate({ ...form, name: form.displayName, preferredLanguage: language });
    if (!values) return;

    setSubmitting(true);
    const { error } = await authClient.signUp.email({
      ...values,
      callbackURL: withNext("/verify-email", next),
      fetchOptions: captcha.fetchOptions,
    });
    setSubmitting(false);
    captcha.reset();

    if (error) {
      setFormError(
        error.code === "USER_ALREADY_EXISTS" || error.status === 422
          ? t("auth.accountExists")
          : isCaptchaError(error)
            ? t("auth.captchaFailed")
            : (error.message ?? t("auth.registerFailed")),
      );
      return;
    }
    setSentTo(values.email);
  }

  if (sentTo) {
    return (
      <AuthCard
        title={t("auth.checkEmailTitle")}
        description={t("auth.checkEmailDescription", { email: sentTo })}
        footer={
          <Link to={withNext("/login", next)} className={authLinkClass}>
            {t("auth.backToSignIn")}
          </Link>
        }
      />
    );
  }

  if (config.data && !config.data.signUpEnabled) {
    return (
      <AuthCard
        title={t("auth.signUpsClosed")}
        description={t("auth.signUpsClosedDescription")}
        footer={
          <>
            {t("auth.haveAccount")}{" "}
            <Link to={withNext("/login", next)} className={authLinkClass}>
              {t("auth.signIn")}
            </Link>
          </>
        }
      />
    );
  }

  return (
    <AuthCard
      title={t("auth.registerTitle")}
      description={t("auth.registerDescription")}
      footer={
        <>
          {t("auth.haveAccount")}{" "}
          <Link to={withNext("/login", next)} className={authLinkClass}>
            {t("auth.signIn")}
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <FormMessage>{formError}</FormMessage>
        <Input
          label={t("auth.name")}
          name="displayName"
          autoComplete="name"
          hint={t("auth.nameHint")}
          error={errors.displayName}
          required
        />
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
        <Input
          label={t("common.password")}
          name="password"
          type="password"
          autoComplete="new-password"
          hint={t("auth.passwordHint")}
          error={errors.password}
          required
        />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium text-text">{t("auth.readIn")}</legend>
          <div className="grid grid-cols-2 gap-2">
            {languageCodes.map((code) => (
              <label
                key={code}
                className={cn(
                  "flex h-12 cursor-pointer items-center justify-center rounded-xl border text-sm font-medium transition-colors",
                  "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent",
                  code === language
                    ? "border-accent bg-accent-soft text-accent-hover"
                    : "border-border bg-surface text-text hover:bg-surface-2",
                )}
              >
                <input
                  type="radio"
                  name="preferredLanguage"
                  value={code}
                  checked={code === language}
                  onChange={() => setLanguage(code)}
                  className="sr-only"
                />
                <span lang={code}>{languages[code].nativeLabel}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {captcha.widget}
        <Button type="submit" size="lg" className="mt-2" disabled={submitting}>
          {submitting ? t("auth.creatingAccount") : t("auth.createAccount")}
        </Button>
      </form>
    </AuthCard>
  );
}
