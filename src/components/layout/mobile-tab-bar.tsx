import { Bell, MessagesSquare, Settings, type LucideIcon } from "lucide-react";
import { NavLink } from "react-router";

import { useUnreadCount } from "@/features/notifications/queries";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/locales/en";

import { UnreadBadge } from "./unread-badge";

const tabs: { to: string; label: MessageKey; icon: LucideIcon }[] = [
  { to: "/rooms", label: "nav.rooms", icon: MessagesSquare },
  { to: "/notifications", label: "notifications.title", icon: Bell },
  { to: "/settings", label: "nav.settings", icon: Settings },
];

export function MobileTabBar() {
  const { t } = useI18n();
  const unread = useUnreadCount();
  return (
    <nav
      aria-label={t("nav.primary")}
      className="sticky bottom-0 z-10 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="flex">
        {tabs.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors",
                  isActive ? "text-accent" : "text-text-muted",
                )
              }
            >
              <span className="relative">
                <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
                {to === "/notifications" && (
                  <UnreadBadge count={unread} className="absolute -top-2 start-3" />
                )}
              </span>
              {t(label)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
