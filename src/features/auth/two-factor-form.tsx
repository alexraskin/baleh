import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { useI18n } from "@/lib/i18n";

/** Second sign-in step, after the password was accepted and a two-factor cookie set. */
export function TwoFactorForm({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useI18n();
  const [backup, setBackup] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const data = new FormData(event.currentTarget);
    const code = String(data.get("code") ?? "").replace(/\s/g, "");
    const trustDevice = data.get("trustDevice") === "on";

    setSubmitting(true);
    const { error } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    setSubmitting(false);
    if (error) {
      setFormError(t("auth.codeInvalid"));
      return;
    }
    onSuccess();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
      <p className="text-sm text-text-muted">
        {backup ? t("auth.backupCodeDescription") : t("auth.twoFactorDescription")}
      </p>
      <FormMessage>{formError}</FormMessage>
      <Input
        key={backup ? "backup" : "totp"}
        label={backup ? t("auth.backupCode") : t("auth.code")}
        name="code"
        autoComplete="one-time-code"
        inputMode={backup ? "text" : "numeric"}
        dir="ltr"
        required
      />
      <label className="flex min-h-11 items-center gap-3 text-sm text-text">
        <input type="checkbox" name="trustDevice" className="size-5 accent-accent" />
        {t("auth.trustDevice")}
      </label>
      <Button type="submit" size="lg" className="mt-2" disabled={submitting}>
        {submitting ? t("auth.verifying") : t("auth.verify")}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setBackup(!backup)}>
        {backup ? t("auth.useAuthenticator") : t("auth.useBackupCode")}
      </Button>
    </form>
  );
}
