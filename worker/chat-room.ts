import { DurableObject } from "cloudflare:workers";

import {
  clientEventSchema,
  PING,
  PONG,
  TYPING_TIMEOUT_MS,
  type PresenceUser,
  type ServerEvent,
} from "../shared/messages.ts";

/** Set by the Worker after it has checked the session and membership. Never from clients. */
export const USER_ID_HEADER = "X-Baleh-User-Id";
/** URI-encoded, since header values must be ASCII. */
export const USER_NAME_HEADER = "X-Baleh-User-Name";

/** Close codes the client acts on. */
export const CloseCode = {
  /** The user was removed from the room or left it. Don't reconnect. */
  removed: 4403,
  /** The room was deleted. Don't reconnect. */
  deleted: 4404,
} as const;

/** Client frames are tiny; anything bigger is ignored. */
const MAX_CLIENT_FRAME = 1024;

/**
 * A repeated "still typing" is relayed at most this often. Clients refresh every
 * TYPING_TIMEOUT_MS / 2, so they're never throttled; a flood is.
 */
const TYPING_RELAY_INTERVAL_MS = TYPING_TIMEOUT_MS / 4;

interface Connection {
  userId: string;
  displayName: string;
  /** Whether the tab shows the room. Hidden tabs still get push notifications. */
  visible?: boolean;
  /** The last typing state relayed for this socket, and when. */
  typing?: boolean;
  typingAt?: number;
}

/**
 * One instance per room. Holds the room's live WebSocket connections and fans
 * out events. Uses the hibernation API, so idle rooms are evicted from memory
 * while sockets stay open; everything it needs survives in socket attachments.
 * It stores nothing: messages live in D1.
 */
export class ChatRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keepalive pings are answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  /** Accepts a WebSocket the Worker has already authorized. */
  override async fetch(request: Request): Promise<Response> {
    const userId = request.headers.get(USER_ID_HEADER);
    const encodedName = request.headers.get(USER_NAME_HEADER);
    const displayName = encodedName && decodeURIComponent(encodedName);
    if (!userId || !displayName) return new Response("Missing identity", { status: 400 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [userId]);
    server.serializeAttachment({ userId, displayName } satisfies Connection);

    const online = this.online();
    this.send(server, { type: "ready", online });
    this.publish({ type: "presence", online }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (typeof data !== "string" || data.length > MAX_CLIENT_FRAME) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    const event = clientEventSchema.safeParse(parsed);
    if (!event.success) return;

    const connection = connectionOf(ws);
    if (event.data.type === "visibility") {
      ws.serializeAttachment({ ...connection, visible: event.data.visible } satisfies Connection);
      return;
    }
    const { userId, displayName } = connection;
    const { typing } = event.data;
    const now = Date.now();
    // State changes always go through; repeats of the same state are throttled.
    if (
      typing === (connection.typing ?? false) &&
      (!typing || now - (connection.typingAt ?? 0) < TYPING_RELAY_INTERVAL_MS)
    ) {
      return;
    }
    ws.serializeAttachment({ ...connection, typing, typingAt: now } satisfies Connection);
    // Messages are sent over HTTP so they're validated and saved before anyone sees them;
    // the socket only carries ephemeral signals.
    this.publish({ type: "typing", userId, displayName, typing }, ws);
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
    this.handleDeparture(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.handleDeparture(ws);
  }

  // RPC, called by the Worker -----------------------------------------------

  /** Sends an event to everyone connected. Used for new messages and translations. */
  async broadcast(event: ServerEvent): Promise<void> {
    this.publish(event);
  }

  /**
   * Users with the room open in a visible tab, who see new messages live and so get
   * no push. Approximate: any visible tab or device counts.
   */
  async activeUserIds(): Promise<string[]> {
    const users = new Set<string>();
    for (const ws of this.openSockets()) {
      const { userId, visible } = connectionOf(ws);
      // Sockets from before visibility was reported count as visible.
      if (visible !== false) users.add(userId);
    }
    return [...users];
  }

  /** Closes a user's connections after they leave or are removed. */
  async disconnectUser(userId: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets(userId)) {
      ws.close(CloseCode.removed, "No longer a member");
    }
    this.publish({ type: "presence", online: this.online() });
  }

  /** Closes every connection after the room is deleted. */
  async disconnectAll(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      ws.close(CloseCode.deleted, "Room deleted");
    }
  }

  // ------------------------------------------------------------------------

  private handleDeparture(ws: WebSocket) {
    const { userId, displayName } = connectionOf(ws);
    const stillHere = this.openSockets().some(
      (other) => other !== ws && connectionOf(other).userId === userId,
    );
    if (!stillHere) this.publish({ type: "typing", userId, displayName, typing: false }, ws);
    this.publish({ type: "presence", online: this.online(ws) }, ws);
  }

  private openSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  /** Distinct users with an open connection, optionally ignoring one that's closing. */
  private online(except?: WebSocket): PresenceUser[] {
    const users = new Map<string, PresenceUser>();
    for (const ws of this.openSockets()) {
      if (ws === except) continue;
      const { userId, displayName } = connectionOf(ws);
      users.set(userId, { userId, displayName });
    }
    return [...users.values()];
  }

  private publish(event: ServerEvent, except?: WebSocket) {
    const frame = JSON.stringify(event);
    for (const ws of this.openSockets()) {
      if (ws !== except) this.trySend(ws, frame);
    }
  }

  private send(ws: WebSocket, event: ServerEvent) {
    this.trySend(ws, JSON.stringify(event));
  }

  private trySend(ws: WebSocket, frame: string) {
    try {
      ws.send(frame);
    } catch {
      // The socket closed between listing and sending; its close handler cleans up.
    }
  }
}

function connectionOf(ws: WebSocket): Connection {
  return ws.deserializeAttachment() as Connection;
}
