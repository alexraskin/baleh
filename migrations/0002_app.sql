-- Application tables. Conventions follow Better Auth's tables: singular names,
-- camelCase columns, text ids, timestamps as ISO 8601 UTC text.
--
-- Deletion policy:
--   * Deleting a room removes everything that belongs to it.
--   * Deleting a user never deletes messages others have seen: authorship is
--     nulled (shown as a former member) so conversation history survives.

create table "room" (
  "id" text not null primary key,
  "name" text not null check (length("name") between 1 and 80),
  "createdBy" text references "user" ("id") on delete set null,
  "createdAt" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updatedAt" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index "room_createdBy_idx" on "room" ("createdBy");

create table "roomMember" (
  "roomId" text not null references "room" ("id") on delete cascade,
  "userId" text not null references "user" ("id") on delete cascade,
  "role" text not null default 'member' check ("role" in ('owner', 'admin', 'member')),
  "joinedAt" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  primary key ("roomId", "userId")
) without rowid;

-- The primary key covers lookups by room; this covers "rooms for a user".
create index "roomMember_userId_idx" on "roomMember" ("userId");

create table "invitation" (
  "id" text not null primary key,
  "roomId" text not null references "room" ("id") on delete cascade,
  "invitedBy" text references "user" ("id") on delete set null,
  "email" text not null check ("email" = lower("email")),
  -- Only a hash of the token is stored; the raw token lives in the invite link.
  "tokenHash" text not null unique,
  "expiresAt" text not null,
  "acceptedAt" text,
  "createdAt" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index "invitation_roomId_idx" on "invitation" ("roomId");
create index "invitation_email_idx" on "invitation" ("email");
create index "invitation_invitedBy_idx" on "invitation" ("invitedBy");

create table "message" (
  "id" text not null primary key,
  "roomId" text not null references "room" ("id") on delete cascade,
  "senderId" text references "user" ("id") on delete set null,
  "originalText" text not null check (length("originalText") <= 8000),
  "originalLanguage" text not null,
  "createdAt" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updatedAt" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Timeline pagination: newest-first within a room, id as a tiebreaker.
create index "message_roomId_createdAt_idx" on "message" ("roomId", "createdAt", "id");
create index "message_senderId_idx" on "message" ("senderId");

create table "messageTranslation" (
  "id" text not null primary key,
  "messageId" text not null references "message" ("id") on delete cascade,
  "targetLanguage" text not null,
  "translatedText" text not null,
  "provider" text not null,
  "model" text not null,
  "createdAt" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique ("messageId", "targetLanguage")
);

create table "attachment" (
  "id" text not null primary key,
  "messageId" text not null references "message" ("id") on delete cascade,
  "roomId" text not null references "room" ("id") on delete cascade,
  "uploadedBy" text references "user" ("id") on delete set null,
  -- R2 key. Objects are not removed by cascades; clean them up in application code.
  "objectKey" text not null unique,
  "contentType" text not null,
  "fileSize" integer not null check ("fileSize" >= 0),
  "width" integer check ("width" > 0),
  "height" integer check ("height" > 0),
  "createdAt" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index "attachment_messageId_idx" on "attachment" ("messageId");
create index "attachment_roomId_idx" on "attachment" ("roomId");
create index "attachment_uploadedBy_idx" on "attachment" ("uploadedBy");
