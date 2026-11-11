import { ChevronsUpDown, LogOut, Settings } from "lucide-react";
import { Link } from "react-router";

import { Avatar } from "@/components/ui/avatar";
import { useMenu } from "@/components/ui/use-menu";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { disablePush } from "@/lib/push";
import type { UserSummary } from "@/types/models";

export interface ProfileMenuProps {
  user: UserSummary;
  /** `full` shows the name beside the avatar (sidebar); `compact` is avatar only (mobile header). */
  variant?: "full" | "compact";
  /** Which way the menu opens relative to the trigger. */
  placement?: "top" | "bottom";
}

export function ProfileMenu({ user, variant = "full", placement = "top" }: ProfileMenuProps) {
  const { t } = useI18n();
  const { open, close, container, trigger, menu } = useMenu();

  async function signOut() {
    close();
    // This browser stops getting the account's notifications.
    await disablePush().catch(() => {});
    // RequireAuth clears the cache and redirects once the session is gone.
    await authClient.signOut();
  }
  const itemClasses =
    "flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-text hover:bg-surface-2";

  return (
    <div {...container} className="relative">
      <button
        {...trigger}
        aria-label={variant === "compact" ? t("nav.openProfileMenu") : undefined}
        className={cn(
          "flex items-center rounded-xl transition-colors hover:bg-surface-2",
          variant === "full" ? "w-full gap-3 p-2 text-start" : "size-11 justify-center",
        )}
      >
        <Avatar
          name={user.displayName}
          src={user.avatarUrl}
          size={variant === "full" ? "md" : "sm"}
        />
        {variant === "full" && (
          <>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">
              <bdi>{user.displayName}</bdi>
            </span>
            <ChevronsUpDown className="size-4 text-text-muted" aria-hidden="true" />
          </>
        )}
      </button>

      {open && (
        <div
          {...menu}
          className={cn(
            "absolute z-20 w-60 rounded-2xl border border-border bg-surface p-1.5 shadow-soft",
            placement === "top" ? "bottom-full mb-2 start-0" : "top-full mt-2 end-0",
          )}
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium text-text">
              <bdi>{user.displayName}</bdi>
            </p>
            <p className="text-xs text-text-muted">{t("nav.signedIn")}</p>
          </div>
          <div className="my-1 h-px bg-border" />
          <Link role="menuitem" to="/settings" onClick={close} className={itemClasses}>
            <Settings className="size-4 text-text-muted" aria-hidden="true" />
            {t("nav.settings")}
          </Link>
          <button type="button" role="menuitem" onClick={signOut} className={itemClasses}>
            <LogOut className="size-4 text-text-muted rtl:-scale-x-100" aria-hidden="true" />
            {t("nav.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}
