import type { ReactNode } from "react";
import { NavLink } from "react-router";

import type { RoomSummary } from "@shared/rooms.ts";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useRooms } from "@/features/rooms/queries";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";

export interface RoomListProps {
  className?: string;
  /** Shown when the user has no rooms yet. */
  empty?: ReactNode;
}

export function RoomList({ className, empty }: RoomListProps) {
  const { t } = useI18n();
  const rooms = useRooms();

  if (rooms.isPending) {
    return (
      <div className={cn("flex justify-center py-8", className)}>
        <Spinner />
      </div>
    );
  }
  if (rooms.isError) {
    return (
      <div className={cn("flex flex-col items-start gap-2 px-3 py-4", className)}>
        <p role="alert" className="text-sm text-text-muted">
          {t("nav.roomsLoadFailed")}
        </p>
        <Button variant="secondary" className="h-9" onClick={() => rooms.refetch()}>
          {t("common.tryAgain")}
        </Button>
      </div>
    );
  }
  if (rooms.data.length === 0) return <div className={className}>{empty}</div>;

  return (
    <ul className={cn("flex flex-col gap-0.5", className)}>
      {rooms.data.map((room) => (
        <li key={room.id}>
          <RoomLink room={room} />
        </li>
      ))}
    </ul>
  );
}

function RoomLink({ room }: { room: RoomSummary }) {
  const { t } = useI18n();
  return (
    <NavLink
      to={`/rooms/${room.id}`}
      className={({ isActive }) =>
        cn(
          "flex min-h-16 items-center gap-3 rounded-xl px-3 py-2.5 transition-colors",
          isActive ? "bg-surface-2" : "hover:bg-surface-2/60",
        )
      }
    >
      <Avatar name={room.name} src={room.avatarUrl ?? undefined} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-text">
          <bdi>{room.name}</bdi>
        </span>
        <span className="truncate text-sm text-text-muted">
          {t("nav.memberCount", { count: room.memberCount })}
        </span>
      </span>
    </NavLink>
  );
}
