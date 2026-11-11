export const notificationTypes = ["room-invitation", "member-joined", "removed-from-room"] as const;

export type NotificationType = (typeof notificationTypes)[number];

/** An in-app notification, as its recipient sees it. */
export interface AppNotification {
  id: string;
  type: NotificationType;
  /** The room, only while the recipient is a member of it (so it can be opened). */
  roomId: string | null;
  roomName: string | null;
  /** Who did it: the inviter, the person who joined, or who removed you. */
  actorName: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  notifications: AppNotification[];
  unreadCount: number;
}
