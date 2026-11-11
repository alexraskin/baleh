import { Check, ChevronDown } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { z } from "zod";

import { displayNameSchema, emailSchema, passwordSchema, type Profile } from "@shared/profile.ts";
import type { NotificationPreferences } from "@shared/push.ts";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { languageCodes, languages, type LanguageCode } from "@/config/i18n";
import { useFormErrors } from "@/features/auth/use-form-errors";
import { AvatarEditor } from "@/features/media/avatar-editor";
import {
  useAppConfig,
  useNotificationPreferences,
  useProfile,
  useRemoveAvatar,
  useSetAvatar,
  useUpdateLanguage,
  useUpdateNotificationPreferences,
  useUpdateProfile,
} from "@/features/profile/queries";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { disablePush, enablePush, isSubscribed, pushSupport } from "@/lib/push";
import { setTheme, storedTheme, themes, type Theme } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";

const profileFormSchema = z.object({ displayName: displayNameSchema });
const emailFormSchema = z.object({ newEmail: emailSchema });
const passwordFormSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don't match.",
  });

export function SettingsPage() {
  const { t } = useI18n();
  useDocumentTitle(t("nav.settings"));
  const profile = useProfile();

  return (
    <div className="flex flex-1 flex-col bg-bg md:bg-surface">
      <PageHeader title={t("nav.settings")} />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-6 md:px-8 md:py-10">
        {profile.isPending ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : profile.isError ? (
          <div className="flex flex-col items-start gap-3">
            <FormMessage>{t("settings.loadFailed")}</FormMessage>
            <Button variant="secondary" onClick={() => profile.refetch()}>
              {t("common.tryAgain")}
            </Button>
          </div>
        ) : (
          <>
            <ProfileSection profile={profile.data} />
            <SettingsSection id="preferences-heading" title={t("settings.preferences")}>
              <div className="flex flex-col gap-6">
                <LanguageSection current={profile.data.preferredLanguage} />
                <AppearanceSection />
              </div>
            </SettingsSection>
            <NotificationsSection userId={profile.data.id} />
            <SettingsSection id="security-heading" title={t("settings.security")}>
              <div className="flex flex-col gap-6">
                <EmailSection current={profile.data.email} />
                <PasswordSection />
                <TwoFactorSection />
              </div>
            </SettingsSection>
            <DeleteAccountSection />
          </>
        )}
      </div>
    </div>
  );
}

// Native <details> so each group collapses without JS state; children stay mounted.
function SettingsSection({
  id,
  title,
  description,
  defaultOpen,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} aria-labelledby={id} className="group flex flex-col">
      <summary
        className={cn(
          "flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-5 py-3",
          "hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        <span className="flex min-w-0 flex-col">
          <h2 id={id} className="font-medium text-text">
            {title}
          </h2>
          {description && <span className="text-sm text-text-muted">{description}</span>}
        </span>
        <ChevronDown
          className="size-5 shrink-0 text-text-muted transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </details>
  );
}

function SubSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div>
        <h3 id={id} className="text-sm font-medium text-text-muted">
          {title}
        </h3>
        {description && <p className="text-sm text-text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function ProfileSection({ profile }: { profile: Profile }) {
  const { t } = useI18n();
  const update = useUpdateProfile();
  const setAvatar = useSetAvatar();
  const removeAvatar = useRemoveAvatar();
  const { errors, validate } = useFormErrors(profileFormSchema);
  const [saved, setSaved] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const values = validate(Object.fromEntries(new FormData(event.currentTarget)));
    if (!values) return;
    update.mutate(values, { onSuccess: () => setSaved(true) });
  }

  return (
    <SettingsSection defaultOpen id="profile-heading" title={t("settings.profile")}>
      <Card className="flex flex-col gap-5 p-5">
        <div className="min-w-0">
          <p className="truncate font-medium text-text">
            <bdi>{profile.displayName}</bdi>
          </p>
          <p className="truncate text-sm text-text-muted">
            <bdi>{profile.email}</bdi>
          </p>
        </div>
        <AvatarEditor
          name={profile.displayName}
          src={profile.avatarUrl}
          purpose="avatar"
          upload={setAvatar.mutateAsync}
          remove={removeAvatar.mutateAsync}
        />
        <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
          <Input
            label={t("settings.displayName")}
            name="displayName"
            defaultValue={profile.displayName}
            autoComplete="name"
            dir="auto"
            error={errors.displayName}
          />
          <FormMessage>{update.isError ? update.error.message : null}</FormMessage>
          <div className="flex items-center justify-end gap-3">
            {saved && !update.isPending && (
              <output className="text-sm text-text-muted">{t("common.saved")}</output>
            )}
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? t("common.saving") : t("common.saveChanges")}
            </Button>
          </div>
        </form>
      </Card>
    </SettingsSection>
  );
}

function LanguageSection({ current }: { current: LanguageCode }) {
  const { t, format } = useI18n();
  const update = useUpdateLanguage();
  // Show the choice immediately; fall back to the server value if saving fails.
  const selected = update.isPending ? (update.variables ?? current) : current;

  return (
    <SubSection
      id="language-heading"
      title={t("common.language")}
      description={t("settings.languageDescription")}
    >
      <Card className="p-1.5">
        <fieldset className="flex flex-col" disabled={update.isPending}>
          <legend className="sr-only">{t("common.language")}</legend>
          {languageCodes.map((code) => {
            const isSelected = code === selected;
            return (
              <label
                key={code}
                className={cn(
                  "flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-xl px-4 transition-colors",
                  "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent",
                  isSelected ? "bg-surface-2" : "hover:bg-surface-2/60",
                )}
              >
                <input
                  type="radio"
                  name="preferred-language"
                  value={code}
                  checked={isSelected}
                  onChange={() => update.mutate(code)}
                  className="sr-only"
                />
                <span className="flex flex-col">
                  <span lang={code} className="font-medium text-text">
                    {languages[code].nativeLabel}
                  </span>
                  {format.language(code) !== languages[code].nativeLabel && (
                    <span className="text-xs text-text-muted">{format.language(code)}</span>
                  )}
                </span>
                {isSelected && <Check className="size-5 text-accent" aria-hidden="true" />}
              </label>
            );
          })}
        </fieldset>
      </Card>
      <FormMessage>{update.isError ? t("settings.languageFailed") : null}</FormMessage>
    </SubSection>
  );
}

const themeLabels = {
  system: "settings.themeSystem",
  light: "settings.themeLight",
  dark: "settings.themeDark",
} as const satisfies Record<Theme, string>;

function AppearanceSection() {
  const { t } = useI18n();
  const [selected, setSelected] = useState(storedTheme);

  return (
    <SubSection
      id="appearance-heading"
      title={t("settings.appearance")}
      description={t("settings.appearanceDescription")}
    >
      <Card className="p-1.5">
        <fieldset className="flex flex-col">
          <legend className="sr-only">{t("settings.appearance")}</legend>
          {themes.map((theme) => {
            const isSelected = theme === selected;
            return (
              <label
                key={theme}
                className={cn(
                  "flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-xl px-4 transition-colors",
                  "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent",
                  isSelected ? "bg-surface-2" : "hover:bg-surface-2/60",
                )}
              >
                <input
                  type="radio"
                  name="theme"
                  value={theme}
                  checked={isSelected}
                  onChange={() => {
                    setTheme(theme);
                    setSelected(theme);
                  }}
                  className="sr-only"
                />
                <span className="font-medium text-text">{t(themeLabels[theme])}</span>
                {isSelected && <Check className="size-5 text-accent" aria-hidden="true" />}
              </label>
            );
          })}
        </fieldset>
      </Card>
    </SubSection>
  );
}

function NotificationsSection({ userId }: { userId: string }) {
  const { t } = useI18n();
  const config = useAppConfig();
  const [support] = useState(pushSupport);
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    support === "supported" ? Notification.permission : "default",
  );
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    isSubscribed().then(setSubscribed, () => setSubscribed(false));
  }, []);

  const vapidPublicKey = config.data?.vapidPublicKey ?? null;

  async function toggle(on: boolean) {
    setBusy(true);
    setFailed(false);
    try {
      if (on && vapidPublicKey) {
        const result = await enablePush(vapidPublicKey, userId);
        setPermission(result);
        setSubscribed(result === "granted");
      } else {
        await disablePush();
        setSubscribed(false);
      }
    } catch {
      setFailed(true);
      setSubscribed(await isSubscribed().catch(() => false));
    } finally {
      setBusy(false);
    }
  }

  let status: ReactNode;
  if (support === "needs-install") {
    status = <p className="text-sm text-text-muted">{t("settings.notificationsInstall")}</p>;
  } else if (support === "unsupported") {
    status = <p className="text-sm text-text-muted">{t("settings.notificationsUnsupported")}</p>;
  } else if (config.isPending || subscribed === null) {
    status = <Spinner />;
  } else if (!vapidPublicKey) {
    status = <p className="text-sm text-text-muted">{t("settings.notificationsUnavailable")}</p>;
  } else if (permission === "denied") {
    status = <p className="text-sm text-text-muted">{t("settings.notificationsDenied")}</p>;
  } else {
    status = (
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text">
          {subscribed ? t("settings.notificationsOn") : t("settings.notificationsOff")}
        </p>
        <Button
          variant={subscribed ? "secondary" : "primary"}
          disabled={busy}
          onClick={() => toggle(!subscribed)}
        >
          {busy
            ? t("common.working")
            : subscribed
              ? t("settings.notificationsDisable")
              : t("settings.notificationsEnable")}
        </Button>
      </div>
    );
  }

  return (
    <SettingsSection
      id="notifications-heading"
      title={t("settings.notifications")}
      description={t("settings.notificationsDescription")}
    >
      <Card className="flex flex-col gap-4 p-5">
        {status}
        <FormMessage>{failed ? t("settings.notificationsFailed") : null}</FormMessage>
      </Card>
      <NotificationPreferencesCard />
    </SettingsSection>
  );
}

const preferenceRows = [
  { key: "messages", label: "settings.notifyMessages", hint: "settings.notifyMessagesHint" },
  { key: "invitations", label: "settings.notifyInvitations", hint: null },
  {
    key: "roomActivity",
    label: "settings.notifyRoomActivity",
    hint: "settings.notifyRoomActivityHint",
  },
] as const satisfies { key: keyof NotificationPreferences; label: string; hint: string | null }[];

function NotificationPreferencesCard() {
  const { t } = useI18n();
  const preferences = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();
  // Show the change immediately; fall back to the server value if saving fails.
  const current = update.isPending ? update.variables : preferences.data;

  if (!current) {
    return preferences.isError ? (
      <FormMessage>{t("settings.notificationPreferencesFailed")}</FormMessage>
    ) : null;
  }

  return (
    <>
      <Card className="p-1.5">
        <fieldset className="flex flex-col" disabled={update.isPending}>
          <legend className="sr-only">{t("settings.notifications")}</legend>
          {preferenceRows.map(({ key, label, hint }) => (
            <label
              key={key}
              className="flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-xl px-4 py-2 hover:bg-surface-2/60"
            >
              <span className="flex flex-col">
                <span className="font-medium text-text">{t(label)}</span>
                {hint && <span className="text-xs text-text-muted">{t(hint)}</span>}
              </span>
              <input
                type="checkbox"
                checked={current[key]}
                onChange={(event) => update.mutate({ ...current, [key]: event.target.checked })}
                className="size-5 shrink-0 accent-accent"
              />
            </label>
          ))}
        </fieldset>
      </Card>
      <FormMessage>
        {update.isError ? t("settings.notificationPreferencesFailed") : null}
      </FormMessage>
    </>
  );
}

function EmailSection({ current }: { current: string }) {
  const { t } = useI18n();
  const { errors, validate } = useFormErrors(emailFormSchema);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSent(false);
    setFormError(null);
    const values = validate(Object.fromEntries(new FormData(event.currentTarget)));
    if (!values) return;
    if (values.newEmail === current) {
      setFormError(t("settings.emailSame"));
      return;
    }

    setSubmitting(true);
    const { error } = await authClient.changeEmail({
      newEmail: values.newEmail,
      callbackURL: "/verify-email?next=%2Fsettings",
    });
    setSubmitting(false);
    if (error) setFormError(t("settings.emailFailed"));
    else setSent(true);
  }

  return (
    <SubSection
      id="email-heading"
      title={t("settings.email")}
      description={t("settings.emailDescription")}
    >
      <Card className="p-5">
        {sent ? (
          <FormMessage tone="success">{t("settings.emailSent", { email: current })}</FormMessage>
        ) : (
          <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
            <Input
              label={t("settings.newEmail")}
              name="newEmail"
              type="email"
              autoComplete="email"
              dir="ltr"
              error={errors.newEmail}
              required
            />
            <FormMessage>{formError}</FormMessage>
            <div className="flex justify-end">
              <Button type="submit" disabled={submitting}>
                {submitting ? t("auth.sending") : t("settings.changeEmail")}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </SubSection>
  );
}

function PasswordSection() {
  const { t } = useI18n();
  const { errors, validate } = useFormErrors(passwordFormSchema);
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    setFormError(null);
    const form = event.currentTarget;
    const values = validate(Object.fromEntries(new FormData(form)));
    if (!values) return;

    setSubmitting(true);
    const { error } = await authClient.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
      revokeOtherSessions: true,
    });
    setSubmitting(false);
    if (error) {
      setFormError(
        error.code === "INVALID_PASSWORD"
          ? t("settings.wrongPassword")
          : t("settings.passwordFailed"),
      );
      return;
    }
    form.reset();
    setSaved(true);
  }

  return (
    <SubSection
      id="password-heading"
      title={t("settings.password")}
      description={t("auth.newPasswordDescription")}
    >
      <Card className="p-5">
        <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
          <Input
            label={t("settings.currentPassword")}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            error={errors.currentPassword}
            required
          />
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
          <FormMessage>{formError}</FormMessage>
          <div className="flex items-center justify-end gap-3">
            {saved && !submitting && (
              <output className="text-sm text-text-muted">{t("settings.passwordChanged")}</output>
            )}
            <Button type="submit" disabled={submitting}>
              {submitting ? t("common.saving") : t("auth.savePassword")}
            </Button>
          </div>
        </form>
      </Card>
    </SubSection>
  );
}

function TwoFactorSection() {
  const { t } = useI18n();
  const session = authClient.useSession();
  const enabled = session.data?.user.twoFactorEnabled === true;
  // Set between turning it on and confirming the first code.
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const form = event.currentTarget;
    const password = String(new FormData(form).get("password") ?? "");
    if (!password) {
      setFormError(t("settings.wrongPassword"));
      return;
    }

    setSubmitting(true);
    const { data, error } = enabled
      ? await authClient.twoFactor.disable({ password })
      : await authClient.twoFactor.enable({ password });
    setSubmitting(false);
    if (error) {
      setFormError(
        error.code === "INVALID_PASSWORD"
          ? t("settings.wrongPassword")
          : t("settings.twoFactorFailed"),
      );
      return;
    }
    form.reset();
    if (data && "totpURI" in data) setSetup(data);
  }

  async function onCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s/g, "");

    setSubmitting(true);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    setSubmitting(false);
    if (error) setFormError(t("auth.codeInvalid"));
    else setSetup(null);
  }

  const secret = setup ? new URL(setup.totpURI).searchParams.get("secret") : null;

  return (
    <SubSection
      id="two-factor-heading"
      title={t("settings.twoFactor")}
      description={t("settings.twoFactorDescription")}
    >
      <Card className="p-5">
        {setup ? (
          <form className="flex flex-col gap-5" onSubmit={onCode} noValidate>
            <p className="text-sm text-text">{t("settings.twoFactorSetup")}</p>
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium text-text">{t("settings.twoFactorSecret")}</p>
              <code dir="ltr" className="rounded-xl bg-surface-2 p-3 text-sm break-all select-all">
                {secret}
              </code>
              <a
                href={setup.totpURI}
                className="self-start text-sm font-medium text-accent hover:text-accent-hover"
              >
                {t("settings.twoFactorOpenApp")}
              </a>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-sm text-text-muted">{t("settings.twoFactorBackupCodes")}</p>
              <ul
                dir="ltr"
                className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-3 font-mono text-sm select-all"
              >
                {setup.backupCodes.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
            </div>
            <Input
              label={t("auth.code")}
              name="code"
              autoComplete="one-time-code"
              inputMode="numeric"
              dir="ltr"
              required
            />
            <FormMessage>{formError}</FormMessage>
            <div className="flex justify-end">
              <Button type="submit" disabled={submitting}>
                {submitting ? t("auth.verifying") : t("auth.verify")}
              </Button>
            </div>
          </form>
        ) : (
          <form className="flex flex-col gap-5" onSubmit={onPassword} noValidate>
            <p className="text-sm text-text">
              {enabled ? t("settings.twoFactorOn") : t("settings.twoFactorOff")}
            </p>
            <Input
              label={t("settings.twoFactorPassword")}
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
            <FormMessage>{formError}</FormMessage>
            <div className="flex justify-end">
              <Button
                type="submit"
                variant={enabled ? "secondary" : "primary"}
                disabled={submitting || session.isPending}
              >
                {submitting
                  ? t("common.working")
                  : enabled
                    ? t("settings.twoFactorDisable")
                    : t("settings.twoFactorEnable")}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </SubSection>
  );
}

function DeleteAccountSection() {
  const { t } = useI18n();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    if (!password) {
      setFormError(t("settings.wrongPassword"));
      return;
    }

    setSubmitting(true);
    const { error } = await authClient.deleteUser({ password });
    setSubmitting(false);
    if (error) {
      setFormError(
        error.code === "INVALID_PASSWORD"
          ? t("settings.wrongPassword")
          : t("settings.deleteAccountFailed"),
      );
      return;
    }
    // RequireAuth clears the cache and redirects once the session is gone.
  }

  return (
    <SettingsSection
      id="delete-account-heading"
      title={t("settings.deleteAccount")}
      description={t("settings.deleteAccountDescription")}
    >
      <Card className="p-5">
        <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
          <Input
            label={t("settings.deleteAccountPassword")}
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <FormMessage>{formError}</FormMessage>
          <div className="flex justify-end">
            <Button type="submit" variant="danger" disabled={submitting}>
              {submitting ? t("settings.deleting") : t("settings.deleteAccount")}
            </Button>
          </div>
        </form>
      </Card>
    </SettingsSection>
  );
}
