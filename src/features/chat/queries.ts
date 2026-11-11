import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";

import type {
  CreateMessageInput,
  Message,
  MessagePage,
  MessageReceipt,
  MessageTranslation,
  ReceiptInput,
} from "@shared/messages.ts";

import { apiFetch } from "@/lib/api";

/*
 * Message history lives in one infinite query per room. Page 0 is the newest
 * page and later pages go back in time. Live and recovered messages are merged
 * into page 0, so the cache always mirrors D1 without refetching everything.
 */

export type MessagesData = InfiniteData<MessagePage, string | undefined>;

export const messagesKey = (roomId: string) => ["rooms", roomId, "messages"] as const;

function messagesPath(roomId: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return `/rooms/${encodeURIComponent(roomId)}/messages${query ? `?${query}` : ""}`;
}

/** Live messages that arrived before the first page loaded, keyed by room. */
const earlyArrivals = new Map<string, Message[]>();

export function useMessages(roomId: string) {
  return useInfiniteQuery({
    queryKey: messagesKey(roomId),
    queryFn: async ({ pageParam }) => {
      const page = await apiFetch<MessagePage>(
        messagesPath(roomId, pageParam ? { before: pageParam } : {}),
      );
      if (pageParam) return page;
      const early = earlyArrivals.get(roomId) ?? [];
      earlyArrivals.delete(roomId);
      return { ...page, messages: mergeMessages(page.messages, early) };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.hasMore ? page.messages[0]?.id : undefined),
    // Live updates keep this fresh; refetching would only reset loaded pages.
    staleTime: Infinity,
  });
}

/** All loaded messages, oldest first. */
export function flattenMessages(data: InfiniteData<MessagePage, unknown> | undefined): Message[] {
  return data ? [...data.pages].reverse().flatMap((page) => page.messages) : [];
}

function compareMessages(a: Message, b: Message) {
  return a.createdAt === b.createdAt
    ? a.id.localeCompare(b.id)
    : a.createdAt.localeCompare(b.createdAt);
}

function mergeMessages(existing: Message[], incoming: Message[]) {
  const known = new Set(existing.map((message) => message.id));
  const fresh = incoming.filter((message) => !known.has(message.id));
  return fresh.length === 0 ? existing : [...existing, ...fresh].sort(compareMessages);
}

/** Merges messages into the newest page, skipping ones already in the cache. */
export function addMessages(queryClient: QueryClient, roomId: string, messages: Message[]) {
  if (messages.length === 0) return;
  if (!queryClient.getQueryData<MessagesData>(messagesKey(roomId))?.pages[0]) {
    // The first page is still loading and may have been read before these were saved.
    earlyArrivals.set(roomId, [...(earlyArrivals.get(roomId) ?? []), ...messages]);
    return;
  }
  queryClient.setQueryData<MessagesData>(messagesKey(roomId), (data) => {
    if (!data?.pages[0]) return data;
    const known = new Set(data.pages.flatMap((page) => page.messages.map((message) => message.id)));
    const fresh = messages.filter((message) => !known.has(message.id));
    if (fresh.length === 0) return data;
    const [newest, ...older] = data.pages;
    return {
      ...data,
      pages: [
        { ...newest, messages: [...newest.messages, ...fresh].sort(compareMessages) },
        ...older,
      ],
    };
  });
}

/** Stores a finished (or failed) translation on its message, wherever it's loaded. */
export function setTranslation(
  queryClient: QueryClient,
  roomId: string,
  messageId: string,
  translation: MessageTranslation,
) {
  queryClient.setQueryData<MessagesData>(messagesKey(roomId), (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            messages: page.messages.map((message) =>
              message.id === messageId
                ? {
                    ...message,
                    translations: [
                      ...message.translations.filter(
                        ({ language }) => language !== translation.language,
                      ),
                      translation,
                    ],
                  }
                : message,
            ),
          })),
        }
      : data,
  );
}

/** Blanks a deleted message wherever it's loaded, keeping its place in the timeline. */
export function markDeleted(
  queryClient: QueryClient,
  roomId: string,
  messageId: string,
  deletedAt: string,
  deletedBy: string,
) {
  queryClient.setQueryData<MessagesData>(messagesKey(roomId), (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            messages: page.messages.map((message) =>
              message.id === messageId
                ? { ...message, text: "", translations: [], attachments: [], deletedAt, deletedBy }
                : message,
            ),
          })),
        }
      : data,
  );
}

/**
 * Reloads the loaded history. Called whenever the socket (re)connects, since
 * events sent while disconnected are never replayed: new messages, finished
 * translations and deletions are only in D1. TanStack refetches each loaded page
 * in turn from the newest, so there are no gaps however much was missed.
 */
export function catchUp(queryClient: QueryClient, roomId: string) {
  return queryClient.invalidateQueries({ queryKey: messagesKey(roomId) });
}

export function postMessage(roomId: string, input: CreateMessageInput) {
  return apiFetch<Message>(messagesPath(roomId), { method: "POST", json: input });
}

export function deleteMessage(roomId: string, messageId: string) {
  return apiFetch(`${messagesPath(roomId)}/${encodeURIComponent(messageId)}`, {
    method: "DELETE",
  });
}

export function postReceipts(roomId: string, input: ReceiptInput) {
  return apiFetch(`/rooms/${encodeURIComponent(roomId)}/receipts`, { method: "POST", json: input });
}

export const messageInfoKey = (roomId: string, messageId?: string) =>
  messageId ? (["message-info", roomId, messageId] as const) : (["message-info", roomId] as const);

/** Per-person delivery and read times for one of your own messages. */
export function useMessageInfo(roomId: string, messageId: string) {
  return useQuery({
    queryKey: messageInfoKey(roomId, messageId),
    queryFn: async () =>
      (
        await apiFetch<{ receipts: MessageReceipt[] }>(
          `${messagesPath(roomId)}/${encodeURIComponent(messageId)}/receipts`,
        )
      ).receipts,
  });
}
