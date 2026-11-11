-- Translation status. One row per message and target language, created as
-- 'pending' in the same batch as the message itself. Pending rows double as a
-- transactional outbox: if publishing the queue job fails, the translator's
-- sweeper finds the stale pending row and publishes it again.
--
-- The table from 0002 was never written to, so it is replaced rather than altered
-- (SQLite can't drop NOT NULL from translatedText).
drop table "messageTranslation";

create table "messageTranslation" (
  "id" text not null primary key,
  "messageId" text not null references "message" ("id") on delete cascade,
  "targetLanguage" text not null,
  "status" text not null default 'pending' check ("status" in ('pending', 'done', 'failed')),
  "translatedText" text check (length("translatedText") <= 16000),
  "provider" text,
  "model" text,
  "createdAt" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updatedAt" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique ("messageId", "targetLanguage")
);

-- The sweeper's scan for stale pending rows.
create index "messageTranslation_pending_idx"
  on "messageTranslation" ("updatedAt")
  where "status" = 'pending';
