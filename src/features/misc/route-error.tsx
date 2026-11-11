import { TriangleAlert } from "lucide-react";
import { isRouteErrorResponse, Link, useRouteError } from "react-router";

import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n";

export function RouteError() {
  const { t } = useI18n();
  const error = useRouteError();
  const description = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : t("misc.errorDescription");

  if (!isRouteErrorResponse(error)) console.error(error);

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <EmptyState
        icon={TriangleAlert}
        title={t("misc.errorTitle")}
        description={description}
        action={
          <Link to="/rooms" className="text-sm font-medium text-accent hover:text-accent-hover">
            {t("common.goToRooms")}
          </Link>
        }
      />
    </div>
  );
}
