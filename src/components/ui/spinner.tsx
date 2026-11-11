import { LoaderCircle } from "lucide-react";

import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  const { t } = useI18n();
  return (
    <output aria-label={label ?? t("common.loading")} className="inline-flex">
      <LoaderCircle
        aria-hidden="true"
        className={cn("size-5 animate-spin text-text-muted", className)}
      />
    </output>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner />
    </div>
  );
}
