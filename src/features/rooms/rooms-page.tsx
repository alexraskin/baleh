import { MessagesSquare, Plus } from "lucide-react";
import { useState } from "react";

import { Logo } from "@/components/brand/logo";
import { ProfileMenu } from "@/components/layout/profile-menu";
import { RoomList } from "@/components/layout/room-list";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { useCurrentUser } from "@/features/profile/use-current-user";
import { useI18n } from "@/lib/i18n";
import { useDocumentTitle } from "@/lib/use-document-title";

import { CreateRoomDialog } from "./create-room-dialog";
import { PendingInvitations } from "./pending-invitations";
import { useRooms } from "./queries";

export function RoomsPage() {
  const { t } = useI18n();
  useDocumentTitle(t("nav.rooms"));
  const user = useCurrentUser();
  const rooms = useRooms();
  const [creating, setCreating] = useState(false);
  const hasRooms = (rooms.data?.length ?? 0) > 0;

  const noRooms = (
    <EmptyState
      icon={MessagesSquare}
      title={t("rooms.noRoomsTitle")}
      description={t("rooms.noRoomsDescription")}
      action={
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden="true" />
          {t("nav.newRoom")}
        </Button>
      }
    />
  );

  return (
    <>
      {/* Mobile: the room list is the screen. */}
      <div className="flex flex-1 flex-col bg-bg md:hidden">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-2 bg-bg/95 px-4">
          <Logo />
          <div className="flex items-center gap-1">
            <IconButton label={t("nav.newRoom")} onClick={() => setCreating(true)}>
              <Plus className="size-5" />
            </IconButton>
            <ProfileMenu user={user} variant="compact" placement="bottom" />
          </div>
        </header>
        <PendingInvitations className="px-2 pb-3" />
        <nav aria-label={t("nav.rooms")} className="px-2 pb-4">
          <RoomList empty={noRooms} />
        </nav>
      </div>

      {/* Desktop: the sidebar already lists rooms. */}
      <div className="hidden flex-1 items-center justify-center md:flex">
        {rooms.isSuccess && !hasRooms ? (
          noRooms
        ) : (
          <EmptyState
            icon={MessagesSquare}
            title={t("rooms.pickTitle")}
            description={t("rooms.pickDescription")}
          />
        )}
      </div>

      <CreateRoomDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
