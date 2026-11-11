import { waitUntil } from "cloudflare:workers";
import { z } from "zod";

import { languageCodes, type LanguageCode } from "../shared/languages.ts";

/*
 * Translation pieces shared by the API Worker (which publishes jobs) and the
 * translator Worker (which consumes them). See translator/index.ts.
 */

export interface TranslationJob {
  messageId: string;
  roomId: string;
  sourceLanguage: string;
  targetLanguages: string[];
}

/** Queue payloads are re-validated on the way in; unknown fields are ignored. */
export const translationJobSchema = z.object({
  messageId: z.string().min(1).max(64),
  roomId: z.string().min(1).max(64),
  sourceLanguage: z.string().min(1).max(16),
  targetLanguages: z.array(z.string().min(1).max(16)).max(32),
}) satisfies z.ZodType<TranslationJob>;

/** Supported, distinct targets, never the source language. */
export function uniqueTargets(job: TranslationJob): LanguageCode[] {
  return languageCodes.filter(
    (code) => code !== job.sourceLanguage && job.targetLanguages.includes(code),
  );
}

/** The model is swappable: anything that can turn text in one language into another. */
export interface TranslationProvider {
  readonly provider: string;
  readonly model: string;
  translate(text: string, source: LanguageCode, target: LanguageCode): Promise<string>;
}

/** Thrown for failures worth retrying later rather than immediately (429, capacity). */
export class RateLimitError extends Error {}

export const M2M100 = "@cf/meta/m2m100-1.2b";

export function workersAiProvider(ai: Ai, model = M2M100): TranslationProvider {
  return {
    provider: "workers-ai",
    model,
    async translate(text, source, target) {
      let output: Ai_Cf_Meta_M2M100_1_2B_Output;
      try {
        output = await ai.run(M2M100, { text, source_lang: source, target_lang: target });
      } catch (error) {
        // Workers AI reports rate limits and capacity as 429 / error 3040.
        if (/\b(429|3040)\b|rate limit|capacity/i.test(String(error))) {
          throw new RateLimitError(String(error), { cause: error });
        }
        throw error;
      }
      return "translated_text" in output ? (output.translated_text ?? "") : "";
    },
  };
}

/** Guards what goes into D1 and onto screens. Throws so the job is retried. */
export function validateTranslation(original: string, translated: string): string {
  const text = translated.trim();
  if (!text) throw new Error("Empty translation");
  // Translations run a little longer than their source, never wildly so.
  if (text.length > Math.max(200, original.length * 4)) throw new Error("Runaway translation");
  return text;
}

/** How many of a room's latest messages a newly needed language gets translated. */
export const BACKFILL_LIMIT = 25;

/**
 * Someone joined a room, or switched language: translate the room's latest messages
 * into their language so they don't land in untranslated history. Older messages
 * stay in the original. Same outbox as sends: pending rows first, then jobs, and the
 * sweeper republishes anything the queue drops. Existing rows are left alone.
 */
export function backfillTranslations(
  db: D1Database,
  queue: Queue<TranslationJob>,
  userId: string,
  roomId: string | null = null,
) {
  // After the response: joining or switching language shouldn't wait on it.
  waitUntil(
    backfill(db, queue, userId, roomId).catch((error: unknown) => {
      console.error("Translation backfill failed", error);
    }),
  );
}

async function backfill(
  db: D1Database,
  queue: Queue<TranslationJob>,
  userId: string,
  roomId: string | null,
) {
  const stamp = new Date().toISOString();
  // ponytail: BACKFILL_LIMIT per room, so a language switch costs rooms × 25 at most.
  const { results: inserted } = await db
    .prepare(
      `insert into "messageTranslation" ("id", "messageId", "targetLanguage", "createdAt", "updatedAt")
       select lower(hex(randomblob(16))), m."id", u."preferredLanguage", ?2, ?2
       from "user" u
       join "roomMember" rm on rm."userId" = u."id"
       join (
         select "id", "roomId", "originalLanguage",
           row_number() over (partition by "roomId" order by "createdAt" desc) as "n"
         from "message"
         where "deletedAt" is null and "sealedText" is not null
           and "roomId" in (select "roomId" from "roomMember" where "userId" = ?1)
       ) m on m."roomId" = rm."roomId"
       where u."id" = ?1 and (?3 is null or rm."roomId" = ?3)
         and m."n" <= ?4 and m."originalLanguage" != u."preferredLanguage"
       on conflict do nothing
       returning "messageId", "targetLanguage"`,
    )
    .bind(userId, stamp, roomId, BACKFILL_LIMIT)
    .all<{ messageId: string; targetLanguage: string }>();
  if (inserted.length === 0) return;

  const { results: messages } = await db
    .prepare(
      `select "id", "roomId", "originalLanguage" from "message"
       where "id" in (select value from json_each(?))`,
    )
    .bind(JSON.stringify(inserted.map((row) => row.messageId)))
    .all<{ id: string; roomId: string; originalLanguage: string }>();
  const targetLanguage = inserted[0]!.targetLanguage;
  const jobs = messages.map((message) => ({
    body: {
      messageId: message.id,
      roomId: message.roomId,
      sourceLanguage: message.originalLanguage,
      targetLanguages: [targetLanguage],
    } satisfies TranslationJob,
  }));
  try {
    // Queues take at most 100 messages per batch.
    for (let i = 0; i < jobs.length; i += 100) await queue.sendBatch(jobs.slice(i, i + 100));
  } catch (error) {
    // The pending rows stay behind; the translator's sweeper republishes them.
    console.error("Translation backfill enqueue failed", error);
  }
}
