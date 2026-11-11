-- Client-generated id for each send, so a retried send (after a dropped
-- connection) returns the original message instead of posting it twice.
alter table "message" add column "clientId" text;

create unique index "message_senderId_clientId_idx"
  on "message" ("senderId", "clientId")
  where "clientId" is not null;
