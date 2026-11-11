import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Route for the mobile back button. Hidden on desktop where the sidebar is visible. */
  backTo?: string;
  leading?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  backTo,
  leading,
  actions,
  className,
}: PageHeaderProps) {
  const { t } = useI18n();
  return (
    <header
      className={cn(
        "sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-bg/95 px-3 md:px-6",
        className,
      )}
    >
      {backTo && (
        <Link
          to={backTo}
          aria-label={t("common.back")}
          className="-ms-1 flex size-11 items-center justify-center rounded-xl text-text-muted hover:bg-surface-2 md:hidden"
        >
          <ArrowLeft className="size-5 rtl:-scale-x-100" aria-hidden="true" />
        </Link>
      )}
      {leading}
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate text-base font-semibold text-text md:text-lg">{title}</h1>
        {subtitle && <p className="truncate text-xs text-text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </header>
  );
}
