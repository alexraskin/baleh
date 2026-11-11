import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import type { UploadTarget } from "../shared/media.ts";
import translator, {
  DEAD_LETTER_QUEUE,
  sealLegacyText,
  sweep,
  type TranslatorEnv,
} from "../translator/index.ts";
import { messageAad, seal, unseal } from "../worker/sealed.ts";
import { BACKFILL_LIMIT, type TranslationJob } from "../worker/translation.ts";
import worker from "../worker/index.ts";
import { ORIGIN, signedInUser, TestClient, uniqueEmail } from "./client.ts";

/** Records what the API Worker publishes, or fails like an unavailable queue. */
function fakeQueue({ failing = false } = {}) {
  const sent: TranslationJob[] = [];
  const queue = {
    send: vi.fn(async (job: TranslationJob) => {
      if (failing) throw new Error("Queue unavailable");
      sent.push(job);
    }),
    sendBatch: vi.fn(async (jobs: { body: TranslationJob }[]) => {
      sent.push(...jobs.map((job) => job.body));
    }),
  };
  return { sent, queue: queue as unknown as Queue<TranslationJob> };
}

/** Workers AI stand-in: tags the text with the target language, or fails on demand. */
function fakeAi(fail?: () => Error | string | undefined) {
  const run = vi.fn(async (_model: string, input: { text: string; target_lang: string }) => {
    const failure = fail?.();
    if (failure instanceof Error) throw failure;
    if (typeof failure === "string") return { translated_text: failure };
    return { translated_text: `[${input.target_lang}] ${input.text}` };
  });
  return { run, ai: { run } as unknown as Ai };
}

function translatorEnv(ai: Ai, queue = fakeQueue().queue): TranslatorEnv {
  return {
    DB: env.DB,
    CHAT_ROOM: env.CHAT_ROOM,
    AI: ai,
    TRANSLATIONS: queue,
    MESSAGE_KEY: env.MESSAGE_KEY,
  };
}

/** Delivers jobs to the translator like Cloudflare Queues would, recording ack/retry. */
async function deliver(
  workerEnv: TranslatorEnv,
  jobs: unknown[],
  { queue = "message-translations", attempts = 1 } = {},
) {
  const outcomes: ({ ack: true } | { retry: QueueRetryOptions | undefined })[] = [];
  const messages = jobs.map((body, index) => ({
    id: `msg-${index}`,
    timestamp: new Date(),
    body,
    attempts,
    ack: () => (outcomes[index] = { ack: true }),
    retry: (options?: QueueRetryOptions) => (outcomes[index] = { retry: options }),
  }));
  const batch = { queue, messages } as unknown as MessageBatch<unknown>;
  await translator.queue(batch, workerEnv);
  return outcomes;
}

/** An English speaker and a Persian speaker sharing a room, publishing to a fake queue. */
async function mixedRoom({ failingQueue = false } = {}) {
  const queue = fakeQueue({ failing: failingQueue });
  const english = await signedInUser("Sam", { TRANSLATIONS: queue.queue });
  const persian = await signedInUser("Maman", { TRANSLATIONS: queue.queue });
  await persian.client.request("/api/me/language", {
    method: "PUT",
    body: { preferredLanguage: "fa" },
  });
  const room = (
    await english.client.request("/api/rooms", { method: "POST", body: { name: "Family" } })
  ).data;
  const invite = await english.client.request(`/api/rooms/${room.id}/invitations`, {
    method: "POST",
    body: { email: persian.email },
  });
  await persian.client.request(`/api/invitations/${invite.data.id}/accept`, { method: "POST" });
  return { english, persian, roomId: room.id as string, published: queue.sent };
}

describe("publishing translation jobs", () => {
  it("broadcasts the original with a pending translation, then publishes one job", async () => {
    const { english, persian, roomId, published } = await mixedRoom();
    const { socket } = await persian.client.connect(roomId);

    const sent = await english.client.sendMessage(roomId, "Dinner at seven?");
    expect(sent.status).toBe(201);
    expect(sent.data.translations).toEqual([{ language: "fa", status: "pending", text: null }]);

    const live = await socket!.messageWithText("Dinner at seven?");
    expect(live.message.translations).toEqual(sent.data.translations);
    expect(published).toEqual([
      { messageId: sent.data.id, roomId, sourceLanguage: "en", targetLanguages: ["fa"] },
    ]);
    socket!.close();
  });

  it("publishes nothing when everyone shares the sender's language", async () => {
    const queue = fakeQueue();
    const owner = await signedInUser("Solo", { TRANSLATIONS: queue.queue });
    const room = (await owner.client.request("/api/rooms", { method: "POST", body: { name: "R" } }))
      .data;

    const sent = await owner.client.sendMessage(room.id, "Note to self");
    expect(sent.data.translations).toEqual([]);
    expect(queue.sent).toEqual([]);
  });

  it("publishes once for a retried send", async () => {
    const { english, roomId, published } = await mixedRoom();
    const clientId = crypto.randomUUID();
    await english.client.sendMessage(roomId, "Once", clientId);
    await english.client.sendMessage(roomId, "Once", clientId);
    expect(published).toHaveLength(1);
  });

  it("still delivers the message when the queue is down, and the sweeper republishes it", async () => {
    const { english, roomId } = await mixedRoom({ failingQueue: true });
    const sent = await english.client.sendMessage(roomId, "Queue is down");
    expect(sent.status).toBe(201);

    const relay = fakeQueue();
    const { ai } = fakeAi();
    // Not stale yet: nothing to do.
    await sweep(translatorEnv(ai, relay.queue));
    expect(relay.sent.find((job) => job.messageId === sent.data.id)).toBeUndefined();

    await sweep(translatorEnv(ai, relay.queue), Date.now() + 16 * 60_000);
    expect(relay.sent).toContainEqual({
      messageId: sent.data.id,
      roomId,
      sourceLanguage: "en",
      targetLanguages: ["fa"],
    });
  });
});

describe("backfilling translations", () => {
  it("translates the latest messages for someone who joins, or switches, to a new language", async () => {
    const queue = fakeQueue();
    const english = await signedInUser("Sam", { TRANSLATIONS: queue.queue });
    const persian = await signedInUser("Maman", { TRANSLATIONS: queue.queue });
    await persian.client.request("/api/me/language", {
      method: "PUT",
      body: { preferredLanguage: "fa" },
    });
    const room = (
      await english.client.request("/api/rooms", { method: "POST", body: { name: "Family" } })
    ).data;
    const ids: string[] = [];
    for (let i = 0; i < BACKFILL_LIMIT + 5; i++) {
      ids.push((await english.client.sendMessage(room.id, `Message ${i}`)).data.id);
    }
    expect(queue.sent).toEqual([]);

    const invite = await english.client.request(`/api/rooms/${room.id}/invitations`, {
      method: "POST",
      body: { email: persian.email },
    });
    await persian.client.request(`/api/invitations/${invite.data.id}/accept`, { method: "POST" });
    const latest = ids.slice(-BACKFILL_LIMIT);
    // Backfill runs after the response.
    await vi.waitFor(() => expect(queue.sent).toHaveLength(BACKFILL_LIMIT));
    expect(queue.sent.map((job) => job.messageId).toSorted()).toEqual(latest.toSorted());
    expect(queue.sent.every((job) => job.targetLanguages.join() === "fa")).toBe(true);

    const history = await persian.client.request(`/api/rooms/${room.id}/messages`);
    const pending = history.data.messages.filter(
      (message: { translations: { status: string }[] }) =>
        message.translations[0]?.status === "pending",
    );
    expect(pending).toHaveLength(BACKFILL_LIMIT);

    queue.sent.length = 0;
    await persian.client.request("/api/me", { method: "PATCH", body: { preferredLanguage: "de" } });
    await vi.waitFor(() => expect(queue.sent).toHaveLength(BACKFILL_LIMIT));
    expect(queue.sent.every((job) => job.targetLanguages.join() === "de")).toBe(true);

    // Switching back finds the rows already there and costs nothing.
    queue.sent.length = 0;
    await persian.client.request("/api/me/language", {
      method: "PUT",
      body: { preferredLanguage: "fa" },
    });
    // A later switch to a new language is the marker that the fa backfill ran.
    await persian.client.request("/api/me/language", {
      method: "PUT",
      body: { preferredLanguage: "ar" },
    });
    await vi.waitFor(() => expect(queue.sent).toHaveLength(BACKFILL_LIMIT));
    expect(queue.sent.every((job) => job.targetLanguages.join() === "ar")).toBe(true);
  });
});

describe("translator", () => {
  it("translates English to Persian, stores it and tells the room", async () => {
    const { english, persian, roomId, published } = await mixedRoom();
    const sent = await english.client.sendMessage(roomId, "Good morning");
    const { socket } = await persian.client.connect(roomId);
    const { ai, run } = fakeAi();

    expect(await deliver(translatorEnv(ai), published)).toEqual([{ ack: true }]);
    expect(run).toHaveBeenCalledWith("@cf/meta/m2m100-1.2b", {
      text: "Good morning",
      source_lang: "en",
      target_lang: "fa",
    });

    const translation = { language: "fa", status: "done", text: "[fa] Good morning" };
    expect(await socket!.next("translation")).toEqual({
      type: "translation",
      messageId: sent.data.id,
      translation,
    });
    const history = await persian.client.request(`/api/rooms/${roomId}/messages`);
    expect(history.data.messages[0]).toMatchObject({
      text: "Good morning",
      language: "en",
      translations: [translation],
    });
    socket!.close();
  });

  it("translates Persian to English", async () => {
    const { english, persian, roomId, published } = await mixedRoom();
    const sent = await persian.client.sendMessage(roomId, "صبح بخیر");
    expect(published).toEqual([
      { messageId: sent.data.id, roomId, sourceLanguage: "fa", targetLanguages: ["en"] },
    ]);

    const { ai } = fakeAi();
    await deliver(translatorEnv(ai), published);
    const history = await english.client.request(`/api/rooms/${roomId}/messages`);
    expect(history.data.messages[0]).toMatchObject({
      text: "صبح بخیر",
      language: "fa",
      translations: [{ language: "en", status: "done", text: "[en] صبح بخیر" }],
    });
  });

  it("translates once per target, never into the source, and ignores duplicate jobs", async () => {
    const { english, roomId, published } = await mixedRoom();
    await english.client.sendMessage(roomId, "Hello");
    const job = published[0]!;
    const { ai, run } = fakeAi();

    await deliver(translatorEnv(ai), [{ ...job, targetLanguages: ["fa", "fa", "en", "xx"] }, job]);
    await deliver(translatorEnv(ai), [job]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![1].target_lang).toBe("fa");
  });

  it("retries model failures with backoff and succeeds on a later attempt", async () => {
    const { english, roomId, published } = await mixedRoom();
    const sent = await english.client.sendMessage(roomId, "Flaky");
    let calls = 0;
    const { ai } = fakeAi(() => (++calls === 1 ? new Error("InferenceUpstreamError") : undefined));

    expect(await deliver(translatorEnv(ai), published)).toEqual([{ retry: { delaySeconds: 5 } }]);
    let history = await english.client.request(`/api/rooms/${roomId}/messages`);
    expect(history.data.messages[0].translations[0].status).toBe("pending");

    expect(await deliver(translatorEnv(ai), published, { attempts: 2 })).toEqual([{ ack: true }]);
    history = await english.client.request(`/api/rooms/${roomId}/messages`);
    expect(history.data.messages[0].id).toBe(sent.data.id);
    expect(history.data.messages[0].translations[0]).toMatchObject({ status: "done" });
  });

  it("backs off longer when rate limited", async () => {
    const { english, roomId, published } = await mixedRoom();
    await english.client.sendMessage(roomId, "Busy");
    const { ai } = fakeAi(() => new Error("3040: Capacity temporarily exceeded"));
    expect(await deliver(translatorEnv(ai), published, { attempts: 3 })).toEqual([
      { retry: { delaySeconds: 120 } },
    ]);
  });

  it("rejects empty model output instead of storing it", async () => {
    const { english, roomId, published } = await mixedRoom();
    await english.client.sendMessage(roomId, "Hello there");
    const { ai } = fakeAi(() => "   ");
    expect(await deliver(translatorEnv(ai), published)).toEqual([{ retry: { delaySeconds: 5 } }]);
    const history = await english.client.request(`/api/rooms/${roomId}/messages`);
    expect(history.data.messages[0].translations[0]).toMatchObject({ status: "pending" });
  });

  it("drops malformed jobs instead of retrying them", async () => {
    const { ai, run } = fakeAi();
    expect(await deliver(translatorEnv(ai), [{ messageId: 42 }])).toEqual([{ ack: true }]);
    expect(run).not.toHaveBeenCalled();
  });

  it("marks translations failed when a job reaches the dead-letter queue", async () => {
    const { english, persian, roomId, published } = await mixedRoom();
    const sent = await english.client.sendMessage(roomId, "Never translated");
    const { socket } = await persian.client.connect(roomId);
    const { ai } = fakeAi();

    expect(await deliver(translatorEnv(ai), published, { queue: DEAD_LETTER_QUEUE })).toEqual([
      { ack: true },
    ]);
    expect(await socket!.next("translation")).toEqual({
      type: "translation",
      messageId: sent.data.id,
      translation: { language: "fa", status: "failed", text: null },
    });

    // A late duplicate that succeeds still fixes it.
    await deliver(translatorEnv(ai), published);
    const history = await persian.client.request(`/api/rooms/${roomId}/messages`);
    expect(history.data.messages[0].translations[0]).toMatchObject({ status: "done" });
    socket!.close();
  });
});

describe("text at rest", () => {
  it("stores originals, translations and replies only as ciphertext", async () => {
    const { english, persian, roomId, published } = await mixedRoom();
    const first = await english.client.sendMessage(roomId, "Good morning");
    await deliver(translatorEnv(fakeAi().ai), published);
    const reply = await persian.client.request(`/api/rooms/${roomId}/messages`, {
      method: "POST",
      body: { text: "صبح بخیر", clientId: crypto.randomUUID(), replyToId: first.data.id },
    });
    expect(reply.data.replyTo).toMatchObject({ id: first.data.id, text: "Good morning" });

    const dump = JSON.stringify([
      (await env.DB.prepare(`select * from "message"`).all()).results,
      (await env.DB.prepare(`select * from "messageTranslation"`).all()).results,
    ]);
    expect(dump).not.toMatch(/Good morning|صبح بخیر/);

    const history = await persian.client.request(`/api/rooms/${roomId}/messages`);
    expect(history.data.messages[0]).toMatchObject({
      text: "Good morning",
      translations: [{ language: "fa", status: "done", text: "[fa] Good morning" }],
    });
    expect(history.data.messages[0]).not.toHaveProperty("sealedText");
    expect(history.data.messages[1].text).toBe("صبح بخیر");
  });

  it("won't open ciphertext moved to another row", async () => {
    const sealed = await seal(env.MESSAGE_KEY, "secret", messageAad("a"));
    expect(await unseal(env.MESSAGE_KEY, sealed, messageAad("a"))).toBe("secret");
    await expect(unseal(env.MESSAGE_KEY, sealed, messageAad("b"))).rejects.toThrow();
  });

  it("refuses to send without a key rather than storing plaintext", async () => {
    const { client } = await signedInUser("Sam", {
      MESSAGE_KEY: { get: async () => "" },
    });
    const room = (await client.request("/api/rooms", { method: "POST", body: { name: "Solo" } }))
      .data;
    const sent = await client.sendMessage(room.id, "Good morning");
    expect(sent.status).toBe(500);
    const stored = await env.DB.prepare(`select 1 from "message" where "roomId" = ?`)
      .bind(room.id)
      .first();
    expect(stored).toBeNull();
  });

  it("seals rows written before encryption, keeping them readable", async () => {
    const { english, persian, roomId } = await mixedRoom();
    const sent = await english.client.sendMessage(roomId, "placeholder");
    await env.DB.batch([
      env.DB.prepare(
        `update "message" set "originalText" = 'Old news', "sealedText" = null where "id" = ?`,
      ).bind(sent.data.id),
      env.DB.prepare(
        `update "messageTranslation" set "status" = 'done', "translatedText" = 'خبر قدیمی'
         where "messageId" = ?`,
      ).bind(sent.data.id),
    ]);
    const before = await persian.client.request(`/api/rooms/${roomId}/messages`);

    await sealLegacyText(translatorEnv(fakeAi().ai));

    const rows = await env.DB.prepare(
      `select m."originalText", t."translatedText" from "message" m
       join "messageTranslation" t on t."messageId" = m."id" where m."id" = ?`,
    )
      .bind(sent.data.id)
      .first();
    expect(rows).toEqual({ originalText: "", translatedText: null });
    const after = await persian.client.request(`/api/rooms/${roomId}/messages`);
    expect(after.data).toEqual(before.data);
    expect(after.data.messages[0]).toMatchObject({
      text: "Old news",
      translations: [{ language: "fa", text: "خبر قدیمی" }],
    });
  });
});

describe("the whole product", () => {
  it("lets an English and a Persian speaker talk, share images, and come back to their history", async () => {
    const queue = fakeQueue();
    const { ai } = fakeAi();
    const register = async (name: string, preferredLanguage: string) => {
      const client = new TestClient({ TRANSLATIONS: queue.queue });
      const email = uniqueEmail(name.toLowerCase());
      expect(
        (await client.register({ email, name, displayName: name, preferredLanguage })).status,
      ).toBe(200);
      return { client, email };
    };

    // 1–2. Both register, each choosing a language.
    const alex = await register("Alex", "en");
    const maman = await register("Maman", "fa");
    expect((await maman.client.request("/api/me")).data.preferredLanguage).toBe("fa");

    // 3–5. Alex creates a private room and invites her; she joins.
    const room = (
      await alex.client.request("/api/rooms", { method: "POST", body: { name: "Family" } })
    ).data;
    const invite = await alex.client.request(`/api/rooms/${room.id}/invitations`, {
      method: "POST",
      body: { email: maman.email },
    });
    const token = new URL(invite.data.inviteUrl).pathname.split("/").at(-1)!;
    expect(
      (await maman.client.request("/api/invite/accept", { method: "POST", body: { token } })).data,
    ).toEqual({
      roomId: room.id,
    });

    const alexSocket = (await alex.client.connect(room.id)).socket!;
    const mamanSocket = (await maman.client.connect(room.id)).socket!;

    // 6–7. Alex writes in English; the original reaches her at once, translation pending.
    const hello = (await alex.client.sendMessage(room.id, "Hi Maman, how are you?")).data;
    const live = await mamanSocket.messageWithText("Hi Maman, how are you?");
    expect(live.message.translations).toEqual([{ language: "fa", status: "pending", text: null }]);

    // 8–9. The translator runs and the Persian translation arrives on its own.
    await deliver(translatorEnv(ai), queue.sent.splice(0));
    expect(await mamanSocket.next("translation")).toMatchObject({
      messageId: hello.id,
      translation: { language: "fa", status: "done", text: "[fa] Hi Maman, how are you?" },
    });

    // 10–11. She replies in Persian; Alex gets English.
    const seen = alexSocket.events.length;
    const reply = (await maman.client.sendMessage(room.id, "خوبم عزیزم")).data;
    expect(reply.language).toBe("fa");
    await deliver(translatorEnv(ai), queue.sent.splice(0));
    expect(await alexSocket.next("translation", seen)).toMatchObject({
      messageId: reply.id,
      translation: { language: "en", status: "done", text: "[en] خوبم عزیزم" },
    });

    // 13. Both share images.
    const png = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...Array(8).fill(0),
    ]);
    for (const { client } of [alex, maman]) {
      const target = (
        await client.request(`/api/rooms/${room.id}/uploads`, {
          method: "POST",
          body: { contentType: "image/png", size: png.byteLength },
        })
      ).data as UploadTarget;
      const put = await worker.fetch(
        new Request(new URL(target.url, ORIGIN), {
          method: "PUT",
          headers: target.headers,
          body: png,
        }) as Request<unknown, IncomingRequestCfProperties>,
        client.env,
      );
      expect(put.status).toBe(200);
      const sent = await client.request(`/api/rooms/${room.id}/messages`, {
        method: "POST",
        body: { clientId: crypto.randomUUID(), attachment: { token: target.token } },
      });
      expect(sent.status).toBe(201);
    }
    alexSocket.close();
    mamanSocket.close();

    // 14. Both sign out and back in; 12. history keeps every original next to its translation.
    for (const person of [alex, maman]) {
      await person.client.signOut();
      expect((await person.client.request(`/api/rooms/${room.id}/messages`)).status).toBe(401);
      expect((await person.client.signIn(person.email)).status).toBe(200);
      const { messages } = (await person.client.request(`/api/rooms/${room.id}/messages`)).data;
      expect(messages).toHaveLength(4);
      expect(messages[0]).toMatchObject({
        text: "Hi Maman, how are you?",
        language: "en",
        translations: [{ language: "fa", status: "done" }],
      });
      expect(messages[1]).toMatchObject({
        text: "خوبم عزیزم",
        language: "fa",
        translations: [{ language: "en", status: "done" }],
      });
      for (const image of messages.slice(2)) {
        const response = await worker.fetch(
          new Request(`${ORIGIN}${image.attachments[0].url}`, {
            headers: { Cookie: person.client.cookieHeader },
          }) as Request<unknown, IncomingRequestCfProperties>,
          person.client.env,
        );
        expect(response.status).toBe(200);
        await response.arrayBuffer();
      }
    }
  });
});
