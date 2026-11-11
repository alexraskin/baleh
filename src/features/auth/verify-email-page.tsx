import { Link, Navigate, useSearchParams } from "react-router";

import { useI18n } from "@/lib/i18n";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useSafeNext } from "@/lib/use-safe-next";

import { AuthCard, authLinkClass } from "./auth-card";

/**
 * Where Better Auth sends people after the emailed verification link: already
 * signed in on success (so go straight on), or back here with `?error=` when the
 * link is invalid or expired.
 */
export function VerifyEmailPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const next = useSafeNext();
  useDocumentTitle(t("auth.verifyFailedTitle"));

  if (!params.has("error")) return <Navigate to={next} replace />;

  return (
    <AuthCard
      title={t("auth.verifyFailedTitle")}
      description={t("auth.verifyFailedDescription")}
      footer={
        <Link to="/login" className={authLinkClass}>
          {t("auth.backToSignIn")}
        </Link>
      }
    />
  );
}
