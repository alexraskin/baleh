-- Unread count and "mark all read" filter on readAt. Without this they read every
-- notification the user ever got (never pruned); with it, only the unread ones.
create index "notification_userId_unread_idx" on "notification" ("userId") where "readAt" is null;
