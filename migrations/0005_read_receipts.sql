-- Read receipts.
--
-- Each member has two watermarks: the newest message they've received and the
-- newest they've read. Values are message cursors, `createdAt || ' ' || id`,
-- which sort in timeline order because createdAt is fixed-width ISO 8601.
-- A message's status follows from comparing its cursor to recipients' watermarks.
alter table "roomMember" add column "deliveredThrough" text;
alter table "roomMember" add column "readThrough" text;

-- When each person received and read each message, for "Message info".
-- Rows are written as watermarks advance.
create table "messageReceipt" (
  "messageId" text not null references "message" ("id") on delete cascade,
  "userId" text not null references "user" ("id") on delete cascade,
  "deliveredAt" text not null,
  "readAt" text,
  primary key ("messageId", "userId")
) without rowid;

create index "messageReceipt_userId_idx" on "messageReceipt" ("userId");
