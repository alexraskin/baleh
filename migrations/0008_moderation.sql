-- Moderation. Room admins already fit roomMember.role (0002); this adds soft
-- deletion of messages. A deleted message keeps its place in the timeline (and
-- receipt cursors) but loses its text, translations and attachments.
alter table "message" add column "deletedAt" text;
alter table "message" add column "deletedBy" text references "user" ("id") on delete set null;
