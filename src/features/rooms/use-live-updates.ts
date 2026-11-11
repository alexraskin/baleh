import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { PING, type ServerEvent } from "@shared/messages.ts";
import type { RoomSummary } from "@shared/rooms.ts";

import { notificationsKey } from "@/features/notifications/queries";
import { profileQueryKey } from "@/features/profile/queries";
import { forgetBookmark } from "@/lib/api";

import { myInvitationsKey, roomKeys } from "./queries";

const KEEPALIVE_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Refetches the room list, and a room's details and pending invitations (or every
 * room's, without an id). Leaves messages alone: the room socket keeps those live.
 */
function invalidateRooms(queryClient: QueryClient, roomId?: string) {
  return queryClient.invalidateQueries({
    queryKey: roomKeys.all,
    predicate: ({ queryKey: [, id, part] }) =>
      (id === undefined || roomId === undefined || id === roomId) &&
      (part === undefined || part === "invitations"),
  });
}

/** Moves a room to its new place in the list, as the server orders it, without a refetch. */
function bumpRoom(queryClient: QueryClient, roomId: string, updatedAt: string) {
  const rooms = queryClient.getQueryData<RoomSummary[]>(roomKeys.all);
  if (!rooms?.some((room) => room.id === roomId)) {
    // Not loaded yet, or a room this tab hasn't seen: let the server fill it in.
    void queryClient.invalidateQueries({ queryKey: roomKeys.all, exact: true });
    return;
  }
  queryClient.setQueryData<RoomSummary[]>(roomKeys.all, (list = []) =>
    list
      .map((room) =>
        room.id === roomId && room.updatedAt < updatedAt ? { ...room, updatedAt } : room,
      )
      // Same order as the server's `order by "updatedAt" desc, "id"` (byte-wise, like SQLite).
      .sort((a, b) =>
        a.updatedAt !== b.updatedAt ? (a.updatedAt < b.updatedAt ? 1 : -1) : a.id < b.id ? -1 : 1,
      ),
  );
}

function refetchAll(queryClient: QueryClient) {
  forgetBookmark();
  void invalidateRooms(queryClient);
  void queryClient.invalidateQueries({ queryKey: myInvitationsKey });
  void queryClient.invalidateQueries({ queryKey: notificationsKey });
  void queryClient.invalidateQueries({ queryKey: profileQueryKey });
}

/**
 * The signed-in user's own socket, open on every page. The server says what
 * changed (rooms, memberships, invitations, profile) and this refetches it.
 */
export function useLiveUpdates() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let connectedBefore = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let keepalive: ReturnType<typeof setInterval> | undefined;

    function handle(event: ServerEvent) {
      // Every event here reports a write, often another user's.
      forgetBookmark();
      switch (event.type) {
        case "room-changed":
          void invalidateRooms(queryClient, event.roomId);
          break;
        case "room-activity":
          bumpRoom(queryClient, event.roomId, event.updatedAt);
          break;
        case "invitations-changed":
          void queryClient.invalidateQueries({ queryKey: myInvitationsKey });
          void queryClient.invalidateQueries({ queryKey: notificationsKey });
          break;
        case "notifications-changed":
          void queryClient.invalidateQueries({ queryKey: notificationsKey });
          break;
        case "profile-changed":
          void queryClient.invalidateQueries({ queryKey: profileQueryKey });
          break;
      }
    }

    function connect() {
      clearTimeout(reconnectTimer);
      if (disposed) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${location.host}/api/ws`);
      socket = ws;

      ws.addEventListener("open", () => {
        attempt = 0;
        keepalive = setInterval(() => ws.send(PING), KEEPALIVE_MS);
        // Anything could have changed while we were away.
        if (connectedBefore) refetchAll(queryClient);
        connectedBefore = true;
      });

      ws.addEventListener("message", (message) => {
        if (typeof message.data !== "string" || message.data === "pong") return;
        try {
          handle(JSON.parse(message.data) as ServerEvent);
        } catch {
          // Ignore malformed frames.
        }
      });

      ws.addEventListener("close", () => {
        clearInterval(keepalive);
        if (socket === ws) socket = null;
        if (disposed) return;
        const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
        attempt += 1;
        reconnectTimer = setTimeout(connect, backoff / 2 + Math.random() * (backoff / 2));
      });
    }

    /** Skip the backoff when the network or tab comes back. */
    function reconnectNow() {
      if (!socket && !disposed && document.visibilityState === "visible") {
        attempt = 0;
        connect();
      }
    }

    connect();
    window.addEventListener("online", reconnectNow);
    document.addEventListener("visibilitychange", reconnectNow);

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      clearInterval(keepalive);
      window.removeEventListener("online", reconnectNow);
      document.removeEventListener("visibilitychange", reconnectNow);
      socket?.close(1000, "Signed out");
    };
  }, [queryClient]);
}
