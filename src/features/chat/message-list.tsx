import { useEffect, useRef, type ReactNode, type RefObject } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n";
import type { MessageView } from "@/types/models";

import { MessageBubble } from "./message-bubble";

export interface MessageListProps {
  messages: MessageView[];
  currentUserId: string;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onRetry: (key: string) => void;
  onReply: (key: string) => void;
  onDiscard: (key: string) => void;
  onInfo: (key: string) => void;
  /** Profile opener for a sender, or undefined when there's no profile to show. */
  profileAction?: (senderId: string) => (() => void) | undefined;
  /** Profile picture for a sender; initials are shown without one. */
  avatarOf?: (senderId: string) => string | undefined;
  onDelete: (key: string) => void;
  /** Shown instead of the list when there are no messages. */
  empty: ReactNode;
  scrollRef: RefObject<HTMLDivElement | null>;
}

/**
 * The conversation, newest at the bottom. The scroller uses `flex-col-reverse`,
 * so it starts at the bottom, stays pinned there as messages arrive, and keeps
 * its place when older pages load above.
 */
export function MessageList({
  messages,
  currentUserId,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onRetry,
  onReply,
  onDiscard,
  onInfo,
  profileAction,
  avatarOf,
  onDelete,
  empty,
  scrollRef,
}: MessageListProps) {
  const { t, format } = useI18n();
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasOlder) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !loadingOlder) onLoadOlder();
      },
      { root: scrollRef.current, rootMargin: "400px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasOlder, loadingOlder, onLoadOlder, scrollRef]);

  if (messages.length === 0) {
    return <div className="flex flex-1 items-center justify-center overflow-y-auto">{empty}</div>;
  }

  return (
    <div ref={scrollRef} className="flex flex-1 flex-col-reverse overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-4 py-6 md:px-8">
        <div ref={sentinelRef} className="flex min-h-8 justify-center pb-4">
          {loadingOlder && <Spinner label={t("chat.loadingEarlier")} />}
          {!hasOlder && <p className="text-xs text-text-muted">{t("chat.start")}</p>}
        </div>
        <ol aria-label={t("chat.messages")} className="flex flex-col gap-3">
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const newDay =
              !previous || format.dayKey(previous.createdAt) !== format.dayKey(message.createdAt);
            const outgoing = message.senderId === currentUserId;
            const showSender = newDay || previous?.senderId !== message.senderId;
            const bubble = (
              <MessageBubble
                message={message}
                outgoing={outgoing}
                showSender={showSender}
                onRetry={() => onRetry(message.key)}
                onReply={() => onReply(message.key)}
                onJumpToQuote={jumpTo}
                onDiscard={() => onDiscard(message.key)}
                onInfo={() => onInfo(message.key)}
                onDelete={() => onDelete(message.key)}
                onSender={message.senderId ? profileAction?.(message.senderId) : undefined}
              />
            );
            return (
              <li key={message.key} id={messageElementId(message.key)}>
                {newDay && (
                  <p className="flex justify-center pt-2 pb-3">
                    <time
                      dateTime={message.createdAt.slice(0, 10)}
                      className="rounded-full bg-surface-2 px-3 py-0.5 text-xs font-medium text-text-muted"
                    >
                      {format.dayHeading(message.createdAt)}
                    </time>
                  </p>
                )}
                {outgoing ? (
                  bubble
                ) : (
                  // Avatar on the first message of a run; a spacer keeps the rest aligned.
                  <div className="flex items-start gap-2">
                    {showSender ? (
                      <Avatar
                        name={message.senderName}
                        src={message.senderId ? avatarOf?.(message.senderId) : undefined}
                        size="xs"
                      />
                    ) : (
                      <span aria-hidden="true" className="w-7 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">{bubble}</div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function messageElementId(key: string) {
  return `message-${key}`;
}

/** Scrolls to a quoted message and flashes it. Older than the loaded history: nothing to do. */
// ponytail: no fetch-until-found for unloaded quotes; add if people reply to old messages a lot
function jumpTo(key: string) {
  const element = document.getElementById(messageElementId(key));
  if (!element) return;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  element.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 900, easing: "ease-out" });
}
