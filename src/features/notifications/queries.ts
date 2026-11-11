import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { NotificationList } from "@shared/notifications.ts";

import { apiFetch } from "@/lib/api";

export const notificationsKey = ["notifications"] as const;

/** The user's latest notifications and unread count. Kept fresh by the user socket. */
export function useNotifications() {
  return useQuery({
    queryKey: notificationsKey,
    queryFn: () => apiFetch<NotificationList>("/notifications"),
  });
}

export function useUnreadCount() {
  return useNotifications().data?.unreadCount ?? 0;
}

/** Marks one notification read, or all of them without an id. Updates the cache right away. */
export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id?: string) =>
      apiFetch(id ? `/notifications/${encodeURIComponent(id)}/read` : "/notifications/read", {
        method: "POST",
      }),
    onMutate: (id) => {
      const readAt = new Date().toISOString();
      queryClient.setQueryData<NotificationList>(notificationsKey, (list) => {
        if (!list) return list;
        const notifications = list.notifications.map((n) =>
          !n.readAt && (!id || n.id === id) ? { ...n, readAt } : n,
        );
        const marked = list.notifications.filter((n) => !n.readAt && (!id || n.id === id)).length;
        return { notifications, unreadCount: Math.max(0, list.unreadCount - marked) };
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationsKey }),
  });
}
