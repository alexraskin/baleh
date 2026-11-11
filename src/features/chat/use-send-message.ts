import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { uploadFile } from "@/lib/upload";
import type { QuotedMessage } from "@/types/models";

import { addMessages, postMessage } from "./queries";

export interface PendingImage {
  file: File;
  /** Object URL for showing the image before it's uploaded. */
  previewUrl: string;
  width?: number;
  height?: number;
}

export interface PendingMessage {
  clientId: string;
  text: string;
  image?: PendingImage;
  replyTo?: QuotedMessage;
  createdAt: string;
  status: "sending" | "failed";
  /** Upload progress from 0 to 1, while an image is uploading. */
  progress?: number;
  error?: string;
}

/**
 * Optimistic sends. A message shows immediately as pending, then moves into
 * the cache once the server confirms it. Retries reuse the client id, so a send
 * that actually landed before the connection dropped is never duplicated.
 * Images upload straight to storage first; a retry uploads again.
 */
export function useSendMessage(roomId: string) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingMessage[]>([]);

  const patch = useCallback((clientId: string, changes: Partial<PendingMessage> | null) => {
    setPending((messages) => {
      if (changes) {
        return messages.map((message) =>
          message.clientId === clientId ? { ...message, ...changes } : message,
        );
      }
      const removed = messages.find((message) => message.clientId === clientId);
      if (removed?.image) URL.revokeObjectURL(removed.image.previewUrl);
      return messages.filter((message) => message.clientId !== clientId);
    });
  }, []);

  const deliver = useCallback(
    async ({ clientId, text, image, replyTo }: PendingMessage) => {
      patch(clientId, { status: "sending", error: undefined, progress: image ? 0 : undefined });
      try {
        const attachment = image && {
          token: await uploadFile(
            `/rooms/${encodeURIComponent(roomId)}/uploads`,
            "attachment",
            image.file,
            (progress) => patch(clientId, { progress }),
          ),
          width: image.width,
          height: image.height,
        };
        const message = await postMessage(roomId, {
          text,
          clientId,
          attachment,
          replyToId: replyTo?.id,
        });
        addMessages(queryClient, roomId, [message]);
        patch(clientId, null);
      } catch (error) {
        patch(clientId, {
          status: "failed",
          error: error instanceof Error ? error.message : undefined,
        });
      }
    },
    [patch, queryClient, roomId],
  );

  const send = useCallback(
    (text: string, image?: PendingImage, replyTo?: QuotedMessage) => {
      const message: PendingMessage = {
        clientId: crypto.randomUUID(),
        text,
        image,
        replyTo,
        createdAt: new Date().toISOString(),
        status: "sending",
      };
      setPending((messages) => [...messages, message]);
      void deliver(message);
    },
    [deliver],
  );

  const retry = useCallback(
    (clientId: string) => {
      const message = pending.find((candidate) => candidate.clientId === clientId);
      if (message) void deliver(message);
    },
    [deliver, pending],
  );

  const discard = useCallback((clientId: string) => patch(clientId, null), [patch]);

  return { pending, send, retry, discard };
}
