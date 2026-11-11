-- Browser push subscriptions: one row per browser (device) a user turned notifications on in.
-- The endpoint and keys let anyone who holds them push to that browser, so they're never
-- returned by the API, not even to their owner.
create table "pushSubscription" (
  "id" text not null primary key,
  "userId" text not null references "user" ("id") on delete cascade,
  -- Unique: a browser has one subscription; re-subscribing under another account moves it.
  "endpoint" text not null unique,
  "p256dh" text not null,
  "auth" text not null,
  "createdAt" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updatedAt" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "lastUsedAt" text
);

create index "pushSubscription_userId_idx" on "pushSubscription" ("userId");

-- What a user wants pushed. No row means everything on.
create table "notificationPreference" (
  "userId" text not null primary key references "user" ("id") on delete cascade,
  "messages" integer not null default 1 check ("messages" in (0, 1)),
  "invitations" integer not null default 1 check ("invitations" in (0, 1)),
  "roomActivity" integer not null default 1 check ("roomActivity" in (0, 1)),
  "updatedAt" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) without rowid;

-- Pushes already sent, keyed by job id and subscription, so a redelivered or retried job
-- doesn't buzz the same browser twice. Pruned by the consumer after two days.
create table "pushDelivery" (
  "id" text not null primary key,
  "sentAt" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) without rowid;

create index "pushDelivery_sentAt_idx" on "pushDelivery" ("sentAt");
