import { Link } from "react-router";

import { useAppConfig } from "@/features/profile/queries";
import { useI18n } from "@/lib/i18n";
import { useDocumentTitle } from "@/lib/use-document-title";

export function HomePage() {
  const { t } = useI18n();
  useDocumentTitle();
  const config = useAppConfig();

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <p className="text-text">{t("home.intro")}</p>
      <div className="flex w-full flex-col gap-3">
        <Link
          to="/login"
          className="inline-flex h-12 items-center justify-center rounded-xl bg-accent px-5 font-medium text-on-accent hover:bg-accent-hover"
        >
          {t("auth.signIn")}
        </Link>
        {config.data?.signUpEnabled && (
          <Link
            to="/register"
            className="inline-flex h-12 items-center justify-center rounded-xl border border-border bg-surface px-5 font-medium text-text hover:bg-surface-2"
          >
            {t("auth.createAnAccount")}
          </Link>
        )}
      </div>
      <div className="flex gap-4">
        {(["privacy", "support"] as const).map((page) => (
          <Link
            key={page}
            to={`/${page}`}
            className="inline-flex min-h-11 items-center text-sm text-text-muted hover:text-text"
          >
            {t(`${page}.title`)}
          </Link>
        ))}
      </div>
    </div>
  );
}
