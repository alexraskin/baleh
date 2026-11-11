-- Replies. A message can quote one earlier message in the same room. Deleting
-- the quoted message is a soft delete, so the reply keeps pointing at its tombstone.
alter table "message" add column "replyToId" text references "message" ("id") on delete set null;
