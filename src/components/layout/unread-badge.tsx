import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";

/** Unread notification count. Renders nothing at zero. */
export function UnreadBadge({ count, className }: { count: number; className?: string }) {
  const { t, format } = useI18n();
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-on-accent",
        className,
      )}
    >
      <span aria-hidden="true">{count > 99 ? `${format.number(99)}+` : format.number(count)}</span>
      <span className="sr-only">{t("notifications.unreadCount", { count })}</span>
    </span>
  );
}
