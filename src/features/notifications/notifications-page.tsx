import { Bell, DoorOpen, Mail, UserPlus, type LucideIcon } from "lucide-react";
import { useNavigate } from "react-router";

import type { AppNotification, NotificationType } from "@shared/notifications.ts";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/locales/en";
import { useDocumentTitle } from "@/lib/use-document-title";

import { useMarkRead, useNotifications } from "./queries";

const kinds: Record<NotificationType, { icon: LucideIcon; text: MessageKey }> = {
  "room-invitation": { icon: Mail, text: "notifications.invited" },
  "member-joined": { icon: UserPlus, text: "notifications.joined" },
  "removed-from-room": { icon: DoorOpen, text: "notifications.removed" },
};

/** Where a notification leads: the room if the user is in it, pending invitations otherwise. */
function destination(notification: AppNotification): string | null {
  if (notification.roomId) return `/rooms/${notification.roomId}`;
  return notification.type === "room-invitation" ? "/rooms" : null;
}

export function NotificationsPage() {
  const { t, error } = useI18n();
  useDocumentTitle(t("notifications.title"));
  const { data, isPending, isError, error: loadError, refetch } = useNotifications();
  const markRead = useMarkRead();

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title={t("notifications.title")}
        actions={
          (data?.unreadCount ?? 0) > 0 && (
            <Button variant="ghost" className="h-9 px-3" onClick={() => markRead.mutate(undefined)}>
              {t("notifications.markAllRead")}
            </Button>
          )
        }
      />
      {isPending ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <p role="alert" className="text-sm text-danger">
            {error(loadError.message)}
          </p>
          <Button variant="secondary" onClick={() => void refetch()}>
            {t("common.tryAgain")}
          </Button>
        </div>
      ) : data.notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={t("notifications.emptyTitle")}
          description={t("notifications.emptyDescription")}
        />
      ) : (
        <ul className="mx-auto flex w-full max-w-2xl flex-col gap-1 p-2 md:p-4">
          {data.notifications.map((notification) => (
            <li key={notification.id}>
              <NotificationItem notification={notification} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationItem({ notification }: { notification: AppNotification }) {
  const { t, rich, format } = useI18n();
  const navigate = useNavigate();
  const markRead = useMarkRead();
  const { icon: Icon, text } = kinds[notification.type];
  const unread = notification.readAt === null;
  const to = destination(notification);

  function open() {
    if (unread) markRead.mutate(notification.id);
    if (to) navigate(to);
  }

  return (
    <button
      type="button"
      onClick={open}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl px-3 py-3 text-start transition-colors hover:bg-surface-2",
        unread && "bg-accent-soft/50",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm text-text">
          {rich(text, {
            name: (
              <bdi className="font-medium">{notification.actorName ?? t("common.someone")}</bdi>
            ),
            room: (
              <bdi className="font-medium break-words">
                {notification.roomName ?? t("notifications.deletedRoom")}
              </bdi>
            ),
          })}
        </span>
        <time
          dateTime={notification.createdAt}
          title={format.full(notification.createdAt)}
          className="text-xs text-text-muted"
        >
          {format.dayTime(notification.createdAt)}
        </time>
      </span>
      {unread && (
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent">
          <span className="sr-only">{t("notifications.unread")}</span>
        </span>
      )}
    </button>
  );
}
