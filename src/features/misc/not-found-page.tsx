import { Compass } from "lucide-react";
import { Link } from "react-router";

import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n";
import { useDocumentTitle } from "@/lib/use-document-title";

export function NotFoundPage() {
  const { t } = useI18n();
  useDocumentTitle(t("misc.notFound"));

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <EmptyState
        icon={Compass}
        title={t("misc.notFoundTitle")}
        description={t("misc.notFoundDescription")}
        action={
          <Link to="/rooms" className="text-sm font-medium text-accent hover:text-accent-hover">
            {t("common.goToRooms")}
          </Link>
        }
      />
    </div>
  );
}
