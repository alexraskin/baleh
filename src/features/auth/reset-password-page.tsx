import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { z } from "zod";

import { passwordSchema } from "@shared/profile.ts";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { useI18n } from "@/lib/i18n";
import { useDocumentTitle } from "@/lib/use-document-title";

import { AuthCard, authLinkClass } from "./auth-card";
import { useFormErrors } from "./use-form-errors";

const schema = z
  .object({ newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don't match.",
  });

export function ResetPasswordPage() {
  const { t } = useI18n();
  useDocumentTitle(t("auth.chooseNewPassword"));
  const [params] = useSearchParams();
  const token = params.get("token");
  const { errors, validate } = useFormErrors(schema);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setFormError(null);
    const values = validate(Object.fromEntries(new FormData(event.currentTarget)));
    if (!values) return;

    setSubmitting(true);
    const { error } = await authClient.resetPassword({ newPassword: values.newPassword, token });
    setSubmitting(false);

    if (error) setFormError(t("auth.resetLinkInvalid"));
    else setDone(true);
  }

  if (!token || params.get("error")) {
    return (
      <AuthCard
        title={t("auth.linkExpired")}
        description={t("auth.linkExpiredDescription")}
        footer={
          <Link to="/forgot-password" className={authLinkClass}>
            {t("auth.requestNewLink")}
          </Link>
        }
      />
    );
  }

  return (
    <AuthCard
      title={t("auth.chooseNewPassword")}
      description={t("auth.newPasswordDescription")}
      footer={
        <Link to="/login" className={authLinkClass}>
          {t("auth.backToSignIn")}
        </Link>
      }
    >
      {done ? (
        <FormMessage tone="success">{t("auth.passwordChanged")}</FormMessage>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <FormMessage>{formError}</FormMessage>
          <Input
            label={t("auth.newPassword")}
            name="newPassword"
            type="password"
            autoComplete="new-password"
            hint={t("auth.passwordHint")}
            error={errors.newPassword}
            required
          />
          <Input
            label={t("auth.confirmPassword")}
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            error={errors.confirmPassword}
            required
          />
          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? t("common.saving") : t("auth.savePassword")}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
