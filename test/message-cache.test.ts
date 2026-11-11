import { describe, expect, it } from "vitest";

import type { Message } from "../shared/messages.ts";

// Browser code, typed against the DOM; this project has Worker types, so load it untyped.
const browserQueries = "../src/features/chat/queries.ts";
const { mergeNewestPage } = (await import(/* @vite-ignore */ browserQueries)) as {
  mergeNewestPage: (fetched: Message[], early: Message[], cached: Message[]) => Message[];
};

function message(id: string, minute: number, text = id): Message {
  return {
    id,
    roomId: "room",
    senderId: "user",
    senderName: "User",
    text,
    language: "en",
    clientId: null,
    createdAt: `2026-01-01T00:${String(minute).padStart(2, "0")}:00.000Z`,
    translations: [],
    attachments: [],
    deletedAt: null,
    deletedBy: null,
    replyTo: null,
  };
}

const ids = (messages: Message[]) => messages.map(({ id }) => id);

describe("refetching the newest page", () => {
  it("keeps messages that reached the cache while the request was in flight", () => {
    // The server read happened before c was saved; c arrived over the socket meanwhile.
    const fetched = [message("a", 1), message("b", 2)];
    const cached = [message("a", 1), message("b", 2), message("c", 3)];
    expect(ids(mergeNewestPage(fetched, [], cached))).toEqual(["a", "b", "c"]);
  });

  it("takes the server's copy of everything it returned", () => {
    const fetched = [message("a", 1, "deleted on the server")];
    const cached = [message("a", 1, "stale")];
    expect(mergeNewestPage(fetched, [], cached)[0]?.text).toBe("deleted on the server");
  });

  it("drops cached messages older than the page, which now belong to later pages", () => {
    const fetched = [message("b", 2), message("c", 3)];
    const cached = [message("a", 1), message("b", 2)];
    expect(ids(mergeNewestPage(fetched, [], cached))).toEqual(["b", "c"]);
  });

  it("adds live messages from before the first load, in order", () => {
    const fetched = [message("a", 1), message("c", 3)];
    expect(ids(mergeNewestPage(fetched, [message("b", 2)], []))).toEqual(["a", "b", "c"]);
  });
});
