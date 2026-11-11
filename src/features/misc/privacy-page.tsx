import { Link } from "react-router";

import { Card } from "@/components/ui/card";
import { brand } from "@/config/brand";
import { useI18n } from "@/lib/i18n";
import { useDocumentTitle } from "@/lib/use-document-title";
import type { MessageKey } from "@/locales/en";

const sections: [label: MessageKey, body: MessageKey][] = [
  ["privacy.storeLabel", "privacy.storeBody"],
  ["privacy.encryptionLabel", "privacy.encryptionBody"],
  ["privacy.accessLabel", "privacy.accessBody"],
  ["privacy.translationLabel", "privacy.translationBody"],
  ["privacy.cookiesLabel", "privacy.cookiesBody"],
  ["privacy.deletingLabel", "privacy.deletingBody"],
];

export function PrivacyPage() {
  const { t } = useI18n();
  useDocumentTitle(t("privacy.title"));

  return (
    <Card className="flex flex-col gap-4 p-6 text-sm text-text-muted sm:p-8">
      <h1 className="text-xl font-semibold text-text">{t("privacy.title")}</h1>
      {sections.map(([label, body]) => (
        <p key={label}>
          <strong className="text-text">{t(label)}</strong> {t(body, { name: brand.name })}
        </p>
      ))}
      <p>
        <strong className="text-text">{t("privacy.contactLabel")}</strong>{" "}
        <a
          href={`mailto:${brand.supportEmail}`}
          className="font-medium text-accent hover:text-accent-hover"
        >
          {brand.supportEmail}
        </a>
      </p>
      <Link to="/" className="font-medium text-accent hover:text-accent-hover">
        {t("common.back")}
      </Link>
    </Card>
  );
}
