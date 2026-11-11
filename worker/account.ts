import { deletePrefix, deleteRoomMedia } from "./media.ts";
import { notifyMembers, notifyRoom } from "./rooms.ts";

/**
 * Account deletion, run by Better Auth just before it deletes the user row. That
 * delete cascades sessions, memberships, receipts and notifications, and nulls the
 * sender on their messages: the messages stay, shown as from a former member.
 *
 * Rooms they owned pass to the longest-standing member, like leaving; rooms that
 * would be left empty are deleted. One batch, so it's atomic.
 */
export async function deleteAccountData(env: Env, userId: string) {
  const db = env.DB;
  const { results: rooms } = await db
    .prepare(`select "roomId" from "roomMember" where "userId" = ?`)
    .bind(userId)
    .all<{ roomId: string }>();
  const roomIds = rooms.map((row) => row.roomId);

  const [, , deleted] = await db.batch([
    db
      .prepare(
        `update "roomMember" set "role" = 'owner'
         where "roomId" in (select "roomId" from "roomMember" where "userId" = ?1)
           and "userId" = (
             select m."userId" from "roomMember" m
             where m."roomId" = "roomMember"."roomId" and m."userId" != ?1
             order by m."joinedAt", m."userId" limit 1
           )
           and not exists (
             select 1 from "roomMember" m
             where m."roomId" = "roomMember"."roomId" and m."role" = 'owner' and m."userId" != ?1
           )`,
      )
      .bind(userId),
    db.prepare(`delete from "roomMember" where "userId" = ?`).bind(userId),
    db
      .prepare(
        `delete from "room"
         where "id" in (select value from json_each(?))
           and not exists (select 1 from "roomMember" where "roomId" = "room"."id")
         returning "id"`,
      )
      .bind(JSON.stringify(roomIds)),
  ]);
  const deletedRooms = new Set(((deleted?.results ?? []) as { id: string }[]).map((row) => row.id));

  // D1 cascades don't reach R2 or live connections. Best effort from here on.
  await Promise.all([
    deletePrefix(env, `avatars/${userId}/`),
    ...roomIds.map(async (roomId) => {
      if (deletedRooms.has(roomId)) {
        await notifyRoom(env, roomId, (room) => room.disconnectAll());
        await deleteRoomMedia(env, roomId);
      } else {
        await notifyRoom(env, roomId, (room) => room.disconnectUser(userId));
        // Members refetch, so their name becomes "former member".
        notifyMembers(env, roomId, { type: "room-changed", roomId });
      }
    }),
  ]);
}
