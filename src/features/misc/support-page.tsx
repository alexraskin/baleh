import { Link } from "react-router";

import { Card } from "@/components/ui/card";
import { brand } from "@/config/brand";
import { useI18n } from "@/lib/i18n";
import { useDocumentTitle } from "@/lib/use-document-title";

export function SupportPage() {
  const { t } = useI18n();
  useDocumentTitle(t("support.title"));

  return (
    <Card className="flex flex-col gap-4 p-6 text-sm text-text-muted sm:p-8">
      <h1 className="text-xl font-semibold text-text">{t("support.title")}</h1>
      <p>{t("support.body")}</p>
      <a
        href={`mailto:${brand.supportEmail}`}
        className="font-medium text-accent hover:text-accent-hover"
      >
        {brand.supportEmail}
      </a>
      <Link to="/" className="font-medium text-accent hover:text-accent-hover">
        {t("common.back")}
      </Link>
    </Card>
  );
}
