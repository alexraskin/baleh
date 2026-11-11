import { Bell, Plus, Settings } from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router";

import { Logo } from "@/components/brand/logo";
import { IconButton } from "@/components/ui/icon-button";
import { useUnreadCount } from "@/features/notifications/queries";
import { CreateRoomDialog } from "@/features/rooms/create-room-dialog";
import { PendingInvitations } from "@/features/rooms/pending-invitations";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import type { UserSummary } from "@/types/models";

import { ProfileMenu } from "./profile-menu";
import { UnreadBadge } from "./unread-badge";
import { RoomList } from "./room-list";

export interface SidebarProps {
  user: UserSummary;
}

export function Sidebar({ user }: SidebarProps) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const unread = useUnreadCount();
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors",
      isActive ? "bg-surface-2 text-text" : "text-text-muted hover:bg-surface-2 hover:text-text",
    );

  return (
    <aside className="hidden w-sidebar shrink-0 flex-col border-e border-border bg-bg md:flex">
      <div className="flex h-16 items-center justify-between px-5">
        <Logo />
      </div>

      <nav aria-label={t("nav.rooms")} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <PendingInvitations className="px-2 pt-2 pb-3" />
        <div className="flex items-center justify-between px-5 pt-2 pb-1">
          <h2 className="text-xs font-medium tracking-wide text-text-muted uppercase">
            {t("nav.rooms")}
          </h2>
          <IconButton
            label={t("nav.newRoom")}
            className="size-8 rounded-lg"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-4" />
          </IconButton>
        </div>
        <RoomList
          className="px-2 pb-2"
          empty={
            <div className="flex flex-col items-start gap-2 px-3 py-4">
              <p className="text-sm text-text-muted">{t("nav.noRooms")}</p>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="text-sm font-medium text-accent hover:text-accent-hover"
              >
                {t("nav.createFirstRoom")}
              </button>
            </div>
          }
        />
      </nav>

      <div className="flex flex-col gap-1 border-t border-border p-2">
        <NavLink to="/notifications" className={linkClass}>
          <Bell className="size-4" aria-hidden="true" />
          <span className="flex-1">{t("notifications.title")}</span>
          <UnreadBadge count={unread} />
        </NavLink>
        <NavLink to="/settings" className={linkClass}>
          <Settings className="size-4" aria-hidden="true" />
          {t("nav.settings")}
        </NavLink>
        <ProfileMenu user={user} />
      </div>

      <CreateRoomDialog open={creating} onClose={() => setCreating(false)} />
    </aside>
  );
}
