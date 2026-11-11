-- In-app notifications. Account email covers sign-in matters only; everything that
-- happens in rooms is told here.
create table "notification" (
  "id" text not null primary key,
  "userId" text not null references "user" ("id") on delete cascade,
  "type" text not null check ("type" in ('room-invitation', 'member-joined', 'removed-from-room')),
  "roomId" text references "room" ("id") on delete cascade,
  "actorId" text references "user" ("id") on delete set null,
  -- A revoked, declined or replaced invitation takes its notification with it.
  "invitationId" text references "invitation" ("id") on delete cascade,
  "readAt" text,
  "createdAt" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index "notification_userId_createdAt_idx" on "notification" ("userId", "createdAt");
create index "notification_roomId_idx" on "notification" ("roomId");
create index "notification_actorId_idx" on "notification" ("actorId");
create index "notification_invitationId_idx" on "notification" ("invitationId");

-- Account emails already sent, keyed by job id, so a redelivered queue message is
-- not sent twice. Ids are hashes; no tokens or addresses are stored.
-- ponytail: never pruned; rows are tiny. Delete ones older than a week if it ever matters.
create table "emailDelivery" (
  "id" text not null primary key,
  "sentAt" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) without rowid;

-- Sign-in now requires a verified email. Accounts so far were created by an operator
-- (sign-up was off in production), so they count as verified.
update "user" set "emailVerified" = 1 where "emailVerified" = 0;
