-- R2 media. Objects live in the private baleh-media bucket; D1 records
-- which object is current. Deleting rows never deletes objects: the Worker does.

-- The user's current profile picture, avatars/{userId}/{imageId}. avatarUrl is
-- the authenticated URL the API serves it from.
alter table "user" add column "avatarKey" text;

-- The room picture lives at rooms/{roomId}/avatar; the version changes with each
-- upload so clients refetch it. Null means no picture.
alter table "room" add column "avatarVersion" text;
