import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  PING,
  TYPING_TIMEOUT_MS,
  type ClientEvent,
  type PresenceUser,
  type ServerEvent,
} from "@shared/messages.ts";
import type { RoomDetail } from "@shared/rooms.ts";

import { roomKeys } from "@/features/rooms/queries";
import { forgetBookmark } from "@/lib/api";

import { addMessages, catchUp, markDeleted, messageInfoKey, setTranslation } from "./queries";

export type ConnectionStatus = "connecting" | "open" | "reconnecting";

/** Close codes from the server that mean "don't come back" (see worker/chat-room.ts). */
const TERMINAL_CLOSE_CODES = new Set([4403, 4404]);

const KEEPALIVE_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;
/** Re-announce typing this often while it continues, well inside the timeout. */
const TYPING_REFRESH_MS = TYPING_TIMEOUT_MS / 2;
/** Stop announcing typing after this long without a keystroke. */
const TYPING_IDLE_MS = 3000;

export interface TypingUser {
  userId: string;
  displayName: string;
}

function socketUrl(roomId: string) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/api/rooms/${encodeURIComponent(roomId)}/ws`;
}

/**
 * Keeps a live connection to a room: merges incoming messages into the cache,
 * tracks presence and typing, and reconnects with backoff. Every (re)connect
 * catches up from D1, so nothing sent while offline is lost.
 */
export function useRoomSocket(roomId: string, currentUserId: string) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [online, setOnline] = useState<PresenceUser[]>([]);
  const [typing, setTyping] = useState<TypingUser[]>([]);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let keepalive: ReturnType<typeof setInterval> | undefined;
    const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

    function clearTyping(userId: string) {
      clearTimeout(typingTimers.get(userId));
      typingTimers.delete(userId);
      setTyping((users) => users.filter((user) => user.userId !== userId));
    }

    function handle(event: ServerEvent) {
      switch (event.type) {
        case "ready":
        case "presence":
          setOnline(event.online);
          break;
        case "message":
          addMessages(queryClient, roomId, [event.message]);
          if (event.message.senderId) clearTyping(event.message.senderId);
          break;
        case "message-deleted":
          markDeleted(queryClient, roomId, event.messageId, event.deletedAt, event.deletedBy);
          break;
        case "translation":
          setTranslation(queryClient, roomId, event.messageId, event.translation);
          break;
        case "receipts":
          queryClient.setQueryData<RoomDetail>(
            roomKeys.detail(roomId),
            (room) =>
              room && {
                ...room,
                members: room.members.map((member) =>
                  member.userId === event.userId
                    ? {
                        ...member,
                        deliveredThrough: event.deliveredThrough,
                        readThrough: event.readThrough,
                      }
                    : member,
                ),
              },
          );
          forgetBookmark();
          void queryClient.invalidateQueries({ queryKey: messageInfoKey(roomId) });
          break;
        case "typing":
          if (event.userId === currentUserId) break;
          if (!event.typing) {
            clearTyping(event.userId);
            break;
          }
          clearTimeout(typingTimers.get(event.userId));
          typingTimers.set(
            event.userId,
            setTimeout(() => clearTyping(event.userId), TYPING_TIMEOUT_MS),
          );
          setTyping((users) =>
            users.some((user) => user.userId === event.userId)
              ? users
              : [...users, { userId: event.userId, displayName: event.displayName }],
          );
          break;
      }
    }

    function connect() {
      clearTimeout(reconnectTimer);
      if (disposed) return;
      const ws = new WebSocket(socketUrl(roomId));
      socketRef.current = ws;

      ws.addEventListener("open", () => {
        attempt = 0;
        setStatus("open");
        sendVisibility();
        keepalive = setInterval(() => ws.send(PING), KEEPALIVE_MS);
        // Others' messages from while we were away may not have reached our replica.
        forgetBookmark();
        catchUp(queryClient, roomId).catch(() => {
          // The next reconnect tries again; live events still flow meanwhile.
        });
      });

      ws.addEventListener("message", (message) => {
        if (typeof message.data !== "string" || message.data === "pong") return;
        try {
          handle(JSON.parse(message.data) as ServerEvent);
        } catch {
          // Ignore malformed frames.
        }
      });

      ws.addEventListener("close", (event) => {
        clearInterval(keepalive);
        if (socketRef.current === ws) socketRef.current = null;
        setOnline([]);
        for (const userId of typingTimers.keys()) clearTyping(userId);
        if (disposed) return;

        // A failed handshake (signed out, removed) looks like any other drop, so ask the
        // API: if the room is gone for us, the room page shows that and unmounts this hook.
        forgetBookmark();
        void queryClient.invalidateQueries({ queryKey: roomKeys.detail(roomId), exact: true });
        if (TERMINAL_CLOSE_CODES.has(event.code)) {
          void queryClient.invalidateQueries({ queryKey: roomKeys.all, exact: true });
          return;
        }

        setStatus("reconnecting");
        const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
        attempt += 1;
        reconnectTimer = setTimeout(connect, backoff / 2 + Math.random() * (backoff / 2));
      });
    }

    /** Tells the room whether it's on screen; hidden tabs still get push notifications. */
    function sendVisibility() {
      const ws = socketRef.current;
      if (ws?.readyState !== WebSocket.OPEN) return;
      const event: ClientEvent = {
        type: "visibility",
        visible: document.visibilityState === "visible",
      };
      ws.send(JSON.stringify(event));
    }

    /** Skip the backoff when the network or tab comes back. */
    function reconnectNow() {
      if (!socketRef.current && !disposed && document.visibilityState === "visible") {
        attempt = 0;
        connect();
      }
    }

    connect();
    window.addEventListener("online", reconnectNow);
    document.addEventListener("visibilitychange", reconnectNow);
    document.addEventListener("visibilitychange", sendVisibility);

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      clearInterval(keepalive);
      for (const timer of typingTimers.values()) clearTimeout(timer);
      window.removeEventListener("online", reconnectNow);
      document.removeEventListener("visibilitychange", reconnectNow);
      document.removeEventListener("visibilitychange", sendVisibility);
      socketRef.current?.close(1000, "Leaving room");
      socketRef.current = null;
      setStatus("connecting");
      setOnline([]);
      setTyping([]);
    };
  }, [roomId, currentUserId, queryClient]);

  const send = useCallback((event: ClientEvent) => {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  }, []);

  return { status, online, typing, send };
}

/**
 * Turns keystrokes into throttled typing signals: announces on the first
 * keystroke, refreshes while typing continues, and stops after a pause.
 */
export function useTypingSignal(send: (event: ClientEvent) => void) {
  const lastSent = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stop = useCallback(() => {
    clearTimeout(idleTimer.current);
    if (lastSent.current !== 0) {
      lastSent.current = 0;
      send({ type: "typing", typing: false });
    }
  }, [send]);

  const keystroke = useCallback(() => {
    const now = Date.now();
    if (now - lastSent.current > TYPING_REFRESH_MS) {
      lastSent.current = now;
      send({ type: "typing", typing: true });
    }
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stop, TYPING_IDLE_MS);
  }, [send, stop]);

  useEffect(() => () => clearTimeout(idleTimer.current), []);

  return { keystroke, stop };
}
