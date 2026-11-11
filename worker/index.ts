import { type Auth, AUTH_BASE_PATH, getAuth, isSignUpEnabled } from "./auth.ts";
import { deliverAccountEmails } from "./email.ts";
import { deliverPushNotifications, drainPushDeadLetters } from "./push.ts";
import { errorResponse, HttpError, json } from "./http.ts";
import {
  acceptInvitation,
  acceptInvitationByToken,
  createInvitation,
  declineInvitation,
  listMyInvitations,
  listRoomInvitations,
  previewInvitation,
  revokeInvitation,
} from "./routes/invitations.ts";
import { localUpload, sweepOrphanedUploads } from "./media.ts";
import {
  getAttachment,
  getAvatar,
  getRoomAvatar,
  removeAvatar,
  removeRoomAvatar,
  requestAttachmentUpload,
  requestAvatarUpload,
  requestRoomAvatarUpload,
  setAvatar,
  setRoomAvatar,
} from "./routes/media.ts";
import {
  connectRoom,
  connectUser,
  createMessage,
  deleteMessage,
  listMessages,
} from "./routes/messages.ts";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "./routes/notifications.ts";
import { getLanguages, getMe, patchMe, putLanguage } from "./routes/profile.ts";
import {
  getNotificationPreferences,
  putNotificationPreferences,
  registerPushSubscription,
  removePushSubscription,
} from "./routes/push.ts";
import { acknowledge, messageInfo } from "./routes/receipts.ts";
import {
  createRoom,
  deleteRoom,
  getRoom,
  leaveRoom,
  listRooms,
  removeMember,
  updateMember,
  updateRoom,
} from "./routes/rooms.ts";

type Params = Record<string, string>;
type Handler = (
  request: Request,
  env: Env,
  auth: Auth,
  params: Params,
) => Response | Promise<Response>;

/**
 * D1 read replication: the client echoes the last bookmark it saw, so each request
 * reads from a replica at least as fresh as its own earlier writes.
 * https://developers.cloudflare.com/d1/best-practices/read-replication/#use-sessions-api
 */
const BOOKMARK_HEADER = "x-d1-bookmark";

/**
 * Routes keyed by "METHOD /path", where `:name` segments become params.
 * Auth routes are delegated to Better Auth below.
 */
const routes: Record<string, Handler> = {
  "GET /api/health": () => json({ ok: true }),
  "GET /api/config": (_request, env) =>
    json({
      signUpEnabled: isSignUpEnabled(env),
      vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
      turnstileSiteKey: (env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY) || null,
    }),
  "GET /api/languages": () => getLanguages(),
  "GET /api/me": (request, env, auth) => getMe(request, env, auth),
  "PATCH /api/me": (request, env, auth) => patchMe(request, env, auth),
  "PUT /api/me/language": (request, env, auth) => putLanguage(request, env, auth),
  "POST /api/me/avatar/uploads": (request, env, auth) => requestAvatarUpload(request, env, auth),
  "PUT /api/me/avatar": (request, env, auth) => setAvatar(request, env, auth),
  "DELETE /api/me/avatar": (request, env, auth) => removeAvatar(request, env, auth),
  "GET /api/me/notification-preferences": (request, env, auth) =>
    getNotificationPreferences(request, env, auth),
  "PUT /api/me/notification-preferences": (request, env, auth) =>
    putNotificationPreferences(request, env, auth),
  "POST /api/push/subscriptions": (request, env, auth) =>
    registerPushSubscription(request, env, auth),
  "DELETE /api/push/subscriptions": (request, env, auth) =>
    removePushSubscription(request, env, auth),
  "GET /api/users/:userId/avatar/:imageId": (request, env, auth, { userId, imageId }) =>
    getAvatar(request, env, auth, userId!, imageId!),

  "GET /api/rooms": (request, env, auth) => listRooms(request, env, auth),
  "POST /api/rooms": (request, env, auth) => createRoom(request, env, auth),
  "GET /api/rooms/:roomId": (request, env, auth, { roomId }) =>
    getRoom(request, env, auth, roomId!),
  "PATCH /api/rooms/:roomId": (request, env, auth, { roomId }) =>
    updateRoom(request, env, auth, roomId!),
  "DELETE /api/rooms/:roomId": (request, env, auth, { roomId }) =>
    deleteRoom(request, env, auth, roomId!),
  "POST /api/rooms/:roomId/leave": (request, env, auth, { roomId }) =>
    leaveRoom(request, env, auth, roomId!),
  "DELETE /api/rooms/:roomId/members/:userId": (request, env, auth, { roomId, userId }) =>
    removeMember(request, env, auth, roomId!, userId!),
  "PATCH /api/rooms/:roomId/members/:userId": (request, env, auth, { roomId, userId }) =>
    updateMember(request, env, auth, roomId!, userId!),
  "POST /api/rooms/:roomId/avatar/uploads": (request, env, auth, { roomId }) =>
    requestRoomAvatarUpload(request, env, auth, roomId!),
  "PUT /api/rooms/:roomId/avatar": (request, env, auth, { roomId }) =>
    setRoomAvatar(request, env, auth, roomId!),
  "DELETE /api/rooms/:roomId/avatar": (request, env, auth, { roomId }) =>
    removeRoomAvatar(request, env, auth, roomId!),
  "GET /api/rooms/:roomId/avatar": (request, env, auth, { roomId }) =>
    getRoomAvatar(request, env, auth, roomId!),
  "GET /api/rooms/:roomId/invitations": (request, env, auth, { roomId }) =>
    listRoomInvitations(request, env, auth, roomId!),
  "POST /api/rooms/:roomId/invitations": (request, env, auth, { roomId }) =>
    createInvitation(request, env, auth, roomId!),
  "DELETE /api/rooms/:roomId/invitations/:invitationId": (request, env, auth, params) =>
    revokeInvitation(request, env, auth, params.roomId!, params.invitationId!),

  "GET /api/rooms/:roomId/messages": (request, env, auth, { roomId }) =>
    listMessages(request, env, auth, roomId!),
  "POST /api/rooms/:roomId/messages": (request, env, auth, { roomId }) =>
    createMessage(request, env, auth, roomId!),
  "DELETE /api/rooms/:roomId/messages/:messageId": (request, env, auth, params) =>
    deleteMessage(request, env, auth, params.roomId!, params.messageId!),
  "POST /api/rooms/:roomId/receipts": (request, env, auth, { roomId }) =>
    acknowledge(request, env, auth, roomId!),
  "GET /api/rooms/:roomId/messages/:messageId/receipts": (request, env, auth, params) =>
    messageInfo(request, env, auth, params.roomId!, params.messageId!),
  "POST /api/rooms/:roomId/uploads": (request, env, auth, { roomId }) =>
    requestAttachmentUpload(request, env, auth, roomId!),
  "GET /api/attachments/:attachmentId": (request, env, auth, { attachmentId }) =>
    getAttachment(request, env, auth, attachmentId!),
  "PUT /api/uploads/:token": (request, env, _auth, { token }) => localUpload(request, env, token!),
  "GET /api/ws": (request, env, auth) => connectUser(request, env, auth),
  "GET /api/rooms/:roomId/ws": (request, env, auth, { roomId }) =>
    connectRoom(request, env, auth, roomId!),

  "GET /api/invitations": (request, env, auth) => listMyInvitations(request, env, auth),
  "POST /api/invitations/:id/accept": (request, env, auth, { id }) =>
    acceptInvitation(request, env, auth, id!),
  "POST /api/invitations/:id/decline": (request, env, auth, { id }) =>
    declineInvitation(request, env, auth, id!),
  "GET /api/notifications": (request, env, auth) => listNotifications(request, env, auth),
  "POST /api/notifications/read": (request, env, auth) =>
    markAllNotificationsRead(request, env, auth),
  "POST /api/notifications/:id/read": (request, env, auth, { id }) =>
    markNotificationRead(request, env, auth, id!),
  "POST /api/invite/preview": (request, env, auth) => previewInvitation(request, env, auth),
  "POST /api/invite/accept": (request, env, auth) => acceptInvitationByToken(request, env, auth),
};

interface CompiledRoute {
  method: string;
  segments: string[];
  handler: Handler;
}

const compiled: CompiledRoute[] = Object.entries(routes).map(([key, handler]) => {
  const [method = "", path = ""] = key.split(" ");
  return { method, segments: path.split("/"), handler };
});

function matchPath(segments: string[], parts: string[]): Params | null {
  if (segments.length !== parts.length) return null;
  const params: Params = {};
  for (const [index, segment] of segments.entries()) {
    const part = parts[index]!;
    if (segment.startsWith(":")) {
      if (!part) return null;
      try {
        params[segment.slice(1)] = decodeURIComponent(part);
      } catch {
        return null;
      }
    } else if (segment !== part) {
      return null;
    }
  }
  return params;
}

async function handle(request: Request, env: Env, session: D1DatabaseSession): Promise<Response> {
  const { pathname } = new URL(request.url);
  // Better Auth needs a full D1Database (it sniffs for exec), so it stays on the primary.
  const auth = getAuth(env);

  if (pathname === AUTH_BASE_PATH || pathname.startsWith(`${AUTH_BASE_PATH}/`)) {
    return auth.handler(request);
  }

  // Route code only uses prepare and batch, which sessions support.
  const sessionEnv: Env = { ...env, DB: session as unknown as D1Database };

  const parts = pathname.split("/");
  let pathMatched = false;
  for (const route of compiled) {
    const params = matchPath(route.segments, parts);
    if (!params) continue;
    if (route.method === request.method) return route.handler(request, sessionEnv, auth, params);
    pathMatched = true;
  }

  if (pathMatched) throw new HttpError(405, "Method not allowed");
  throw new HttpError(404, "Not found");
}

export { ChatRoom } from "./chat-room.ts";

export default {
  async fetch(request, env) {
    // No bookmark (fresh page load): start on the primary so reads see the latest writes.
    const session = env.DB.withSession(request.headers.get(BOOKMARK_HEADER) ?? "first-primary");
    let response: Response;
    try {
      response = await handle(request, env, session);
    } catch (error) {
      response = errorResponse(error);
    }
    // Someone opened an API URL in the browser (e.g. an attachment in a new tab):
    // send them to a page instead of raw JSON. fetch() calls are never "navigate".
    if (!response.ok && request.headers.get("Sec-Fetch-Mode") === "navigate") {
      const page = response.status === 401 ? "/login" : "/not-found";
      return Response.redirect(new URL(page, request.url).href, 302);
    }
    const bookmark = session.getBookmark();
    if (!bookmark || response.webSocket) return response;
    // Responses from fetch() or Durable Objects have immutable headers.
    response = new Response(response.body, response);
    response.headers.set(BOOKMARK_HEADER, bookmark);
    return response;
  },
  async queue(batch, env) {
    switch (batch.queue) {
      case "baleh-push-notifications":
        return deliverPushNotifications(batch, env);
      case "baleh-push-notifications-dlq":
        return drainPushDeadLetters(batch);
      default:
        return deliverAccountEmails(batch, env);
    }
  },
  async scheduled(_controller, env) {
    await sweepOrphanedUploads(env);
  },
} satisfies ExportedHandler<Env>;
