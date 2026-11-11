-- Message text encrypted at rest (worker/sealed.ts). New rows write the ciphertext here
-- and leave the plaintext column empty ('' for the original, null for a translation);
-- the old columns' length checks can't hold ciphertext, and SQLite can't alter a check.
-- The translator's sweeper seals rows written before this migration.
alter table "message" add column "sealedText" text;
alter table "messageTranslation" add column "sealedText" text;
