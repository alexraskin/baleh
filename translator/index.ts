import { isLanguageCode } from "../shared/languages.ts";
import type { MessageTranslation } from "../shared/messages.ts";
import {
  RateLimitError,
  translationJobSchema,
  uniqueTargets,
  validateTranslation,
  workersAiProvider,
  type TranslationJob,
  type TranslationProvider,
} from "../worker/translation.ts";
import type { MessageKey } from "../worker/sealed.ts";
import { messageAad, readText, seal, translationAad } from "../worker/sealed.ts";

/*
 * Translation consumer. The API Worker saves a message, broadcasts the
 * original, and publishes a TranslationJob; this Worker translates it once per
 * target language, stores the result, and tells the room. Jobs are idempotent:
 * a translation that's already done is never redone, so retries and duplicate
 * jobs are harmless.
 */

export interface TranslatorEnv {
  DB: D1Database;
  AI: Ai;
  CHAT_ROOM: Env["CHAT_ROOM"];
  TRANSLATIONS: Queue<TranslationJob>;
  /** Base64 AES-256 key for message text at rest; the same secret as baleh-web's. */
  MESSAGE_KEY: MessageKey;
}

export const DEAD_LETTER_QUEUE = "message-translations-dlq";

/** Pending rows untouched this long are republished by the sweeper (the outbox relay). */
const STALE_AFTER_MS = 15 * 60_000;
/** Pending rows older than this are given up on. */
const GIVE_UP_AFTER_MS = 24 * 60 * 60_000;

export function retryDelaySeconds(attempts: number, rateLimited: boolean) {
  return Math.min(300, (rateLimited ? 30 : 5) * 2 ** (attempts - 1));
}

export default {
  async queue(batch, env) {
    if (batch.queue === DEAD_LETTER_QUEUE) return failJobs(batch, env);
    const provider = workersAiProvider(env.AI);
    // ponytail: one job at a time, so duplicates in a batch translate once. Fine at family
    // scale; run distinct messageIds in parallel if batches get slow.
    for (const message of batch.messages) await consume(message, env, provider);
  },

  async scheduled(_controller, env) {
    await sweep(env);
  },
} satisfies ExportedHandler<TranslatorEnv, unknown>;

async function consume(
  message: Message<unknown>,
  env: TranslatorEnv,
  provider: TranslationProvider,
) {
  const job = translationJobSchema.safeParse(message.body);
  if (!job.success) {
    // Retrying a malformed job can't help.
    console.error("Dropping malformed translation job", message.id, job.error);
    message.ack();
    return;
  }
  try {
    await translate(job.data, env, provider);
    message.ack();
  } catch (error) {
    const rateLimited = error instanceof RateLimitError;
    console.error("Translation failed", { job: job.data, attempts: message.attempts, error });
    // After max_retries the queue moves the job to the dead-letter queue.
    message.retry({ delaySeconds: retryDelaySeconds(message.attempts, rateLimited) });
  }
}

export async function translate(
  job: TranslationJob,
  env: TranslatorEnv,
  provider: TranslationProvider,
) {
  const original = await env.DB.prepare(
    `select "roomId", "originalText", "sealedText", "originalLanguage", "deletedAt"
     from "message" where "id" = ?`,
  )
    .bind(job.messageId)
    .first<{
      roomId: string;
      originalText: string;
      sealedText: string | null;
      originalLanguage: string;
      deletedAt: string | null;
    }>();
  // Deleted since (room removed, or the message itself): nothing to do.
  if (!original || original.roomId !== job.roomId || original.deletedAt) return;

  const source = original.originalLanguage;
  if (!isLanguageCode(source)) return;
  const originalText =
    (await readText(
      env.MESSAGE_KEY,
      original.sealedText,
      original.originalText,
      messageAad(job.messageId),
    )) ?? "";

  for (const target of uniqueTargets({ ...job, sourceLanguage: source })) {
    const existing = await env.DB.prepare(
      `select "status" from "messageTranslation" where "messageId" = ? and "targetLanguage" = ?`,
    )
      .bind(job.messageId, target)
      .first<{ status: string }>();
    if (existing?.status === "done") continue;

    const text = validateTranslation(
      originalText,
      await provider.translate(originalText, source, target),
    );
    const sealed = await seal(env.MESSAGE_KEY, text, translationAad(job.messageId, target));

    // The unique (messageId, targetLanguage) key makes this the only translation; a
    // concurrent duplicate job that finished first wins and this one changes nothing.
    const now = new Date().toISOString();
    const saved = await env.DB.prepare(
      `insert into "messageTranslation"
         ("id", "messageId", "targetLanguage", "status", "sealedText", "provider", "model", "createdAt", "updatedAt")
       select ?1, ?2, ?3, 'done', ?4, ?5, ?6, ?7, ?7
       -- The message may have been deleted while the provider was working.
       where exists (select 1 from "message" where "id" = ?2 and "deletedAt" is null)
       on conflict ("messageId", "targetLanguage") do update set
         "status" = 'done', "sealedText" = ?4, "provider" = ?5, "model" = ?6, "updatedAt" = ?7
       where "status" != 'done'`,
    )
      .bind(
        crypto.randomUUID(),
        job.messageId,
        target,
        sealed,
        provider.provider,
        provider.model,
        now,
      )
      .run();

    if (saved.meta.changes > 0) {
      await notify(env, job.roomId, job.messageId, { language: target, status: "done", text });
    }
  }
}

/** Jobs that exhausted their retries: mark what's still pending as failed. */
async function failJobs(batch: MessageBatch<unknown>, env: TranslatorEnv) {
  for (const message of batch.messages) {
    const job = translationJobSchema.safeParse(message.body);
    if (job.success) {
      const { results } = await env.DB.prepare(
        `update "messageTranslation" set "status" = 'failed', "updatedAt" = ?
         where "messageId" = ? and "status" = 'pending'
         returning "targetLanguage"`,
      )
        .bind(new Date().toISOString(), job.data.messageId)
        .all<{ targetLanguage: MessageTranslation["language"] }>();
      for (const { targetLanguage } of results) {
        await notify(env, job.data.roomId, job.data.messageId, {
          language: targetLanguage,
          status: "failed",
          text: null,
        });
      }
    }
    message.ack();
  }
}

/**
 * Outbox relay. Republishes jobs whose pending rows have gone quiet (the API's
 * publish failed, or a job was lost) and gives up on very old ones.
 */
export async function sweep(env: TranslatorEnv, now = Date.now()) {
  await sealLegacyText(env);
  const staleBefore = new Date(now - STALE_AFTER_MS).toISOString();
  const giveUpBefore = new Date(now - GIVE_UP_AFTER_MS).toISOString();
  const stamp = new Date(now).toISOString();

  const { results: expired } = await env.DB.prepare(
    `update "messageTranslation" set "status" = 'failed', "updatedAt" = ?
     where "status" = 'pending' and "createdAt" < ?
     returning "messageId", "targetLanguage",
       (select "roomId" from "message" where "id" = "messageId") as "roomId"`,
  )
    .bind(stamp, giveUpBefore)
    .all<{ messageId: string; targetLanguage: MessageTranslation["language"]; roomId: string }>();
  for (const row of expired) {
    await notify(env, row.roomId, row.messageId, {
      language: row.targetLanguage,
      status: "failed",
      text: null,
    });
  }

  const { results: stale } = await env.DB.prepare(
    `select t."messageId", m."roomId", m."originalLanguage",
       json_group_array(t."targetLanguage") as "targets"
     from "messageTranslation" t join "message" m on m."id" = t."messageId"
     where t."status" = 'pending' and t."updatedAt" < ?
     group by t."messageId"
     limit 100`,
  )
    .bind(staleBefore)
    .all<{ messageId: string; roomId: string; originalLanguage: string; targets: string }>();
  if (stale.length === 0) return;

  await env.TRANSLATIONS.sendBatch(
    stale.map((row) => ({
      body: {
        messageId: row.messageId,
        roomId: row.roomId,
        sourceLanguage: row.originalLanguage,
        targetLanguages: JSON.parse(row.targets) as string[],
      },
    })),
  );
  await env.DB.prepare(
    `update "messageTranslation" set "updatedAt" = ?
     where "status" = 'pending' and "messageId" in (select value from json_each(?))`,
  )
    .bind(stamp, JSON.stringify(stale.map((row) => row.messageId)))
    .run();
}

/** Best effort: D1 has the result, and clients resync on reconnect. */
async function notify(
  env: TranslatorEnv,
  roomId: string,
  messageId: string,
  translation: MessageTranslation,
) {
  try {
    await env.CHAT_ROOM.getByName(roomId).broadcast({
      type: "translation",
      messageId,
      translation,
    });
  } catch (error) {
    console.error("Translation broadcast failed", error);
  }
}

/**
 * Encrypts text written before sealed columns existed, a batch per sweep. Each update
 * re-checks the plaintext it read, so a concurrent delete or translation isn't undone.
 */
export async function sealLegacyText(env: TranslatorEnv, limit = 200) {
  const { results: messages } = await env.DB.prepare(
    `select "id", "originalText" from "message"
     where "sealedText" is null and "originalText" != '' limit ?`,
  )
    .bind(limit)
    .all<{ id: string; originalText: string }>();
  const { results: translations } = await env.DB.prepare(
    `select "id", "messageId", "targetLanguage", "translatedText" from "messageTranslation"
     where "sealedText" is null and "translatedText" is not null limit ?`,
  )
    .bind(limit)
    .all<{ id: string; messageId: string; targetLanguage: string; translatedText: string }>();

  const statements = [
    ...(await Promise.all(
      messages.map(async (row) =>
        env.DB.prepare(
          `update "message" set "sealedText" = ?, "originalText" = ''
           where "id" = ? and "sealedText" is null and "originalText" = ?`,
        ).bind(
          await seal(env.MESSAGE_KEY, row.originalText, messageAad(row.id)),
          row.id,
          row.originalText,
        ),
      ),
    )),
    ...(await Promise.all(
      translations.map(async (row) =>
        env.DB.prepare(
          `update "messageTranslation" set "sealedText" = ?, "translatedText" = null
           where "id" = ? and "sealedText" is null and "translatedText" = ?`,
        ).bind(
          await seal(
            env.MESSAGE_KEY,
            row.translatedText,
            translationAad(row.messageId, row.targetLanguage),
          ),
          row.id,
          row.translatedText,
        ),
      ),
    )),
  ];
  if (statements.length > 0) await env.DB.batch(statements);
}
