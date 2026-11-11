-- Indexes for foreign keys added in 0008 and 0009. Without them, deleting a
-- message (e.g. when its room is deleted) scans the whole message table for
-- replies to null out, and deleting a user scans it for moderation records.
create index "message_replyToId_idx" on "message" ("replyToId") where "replyToId" is not null;
create index "message_deletedBy_idx" on "message" ("deletedBy") where "deletedBy" is not null;
