import { MessageSquareOff, MessagesSquare, Settings, UserPlus, WifiOff } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useParams } from "react-router";

import { deliveryStatus } from "@shared/messages.ts";
import type { RoomDetail } from "@shared/rooms.ts";

import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { Spinner } from "@/components/ui/spinner";
import { Composer } from "@/features/chat/composer";
import { MessageInfoDialog } from "@/features/chat/message-info-dialog";
import { MessageList } from "@/features/chat/message-list";
import { deleteMessage, flattenMessages, useMessages } from "@/features/chat/queries";
import { useReceiptAcks } from "@/features/chat/use-receipt-acks";
import { useRoomSocket, useTypingSignal, type TypingUser } from "@/features/chat/use-room-socket";
import { useSendMessage, type PendingImage } from "@/features/chat/use-send-message";
import { useCurrentUser } from "@/features/profile/use-current-user";
import { ApiError } from "@/lib/api";
import { useI18n, type I18n } from "@/lib/i18n";
import { useDocumentTitle } from "@/lib/use-document-title";
import type { MessageView, QuotedMessage } from "@/types/models";

import { InviteMemberDialog } from "./invite-member-dialog";
import { MemberProfileDialog } from "./member-profile-dialog";
import { useRoom } from "./queries";

export function RoomPage() {
  const { roomId = "" } = useParams<{ roomId: string }>();
  const { t } = useI18n();
  const room = useRoom(roomId);
  useDocumentTitle(room.data?.name ?? (room.isError ? t("room.notFound") : undefined));

  if (room.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  // A failed background refetch keeps the chat (and its unsent messages) on screen;
  // only a 404 means the room is gone for us (removed, deleted, never a member).
  const gone = room.error instanceof ApiError && room.error.status === 404;
  if (gone || !room.data) return <RoomNotFound />;

  // Keyed so connection and draft state never leak between rooms.
  return <RoomChat key={room.data.id} room={room.data} />;
}

function RoomChat({ room }: { room: RoomDetail }) {
  const i18n = useI18n();
  const { t } = i18n;
  const user = useCurrentUser();
  const online = useOnline();
  const socket = useRoomSocket(room.id, user.id);
  const typingSignal = useTypingSignal(socket.send);
  const history = useMessages(room.id);
  const sender = useSendMessage(room.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [inviting, setInviting] = useState(false);

  const isOwner = room.role === "owner";
  const isModerator = room.role !== "member";
  const [deleting, setDeleting] = useState<string | null>(null);
  // The socket event updates the cache for everyone, including us.
  const remove = useMutation({ mutationFn: (id: string) => deleteMessage(room.id, id) });
  const alone = room.memberCount === 1;
  const othersOnline = socket.online.filter((person) => person.userId !== user.id).length;

  const [infoFor, setInfoFor] = useState<{ id: string; text: string } | null>(null);
  const [replyingTo, setReplyingTo] = useState<QuotedMessage | null>(null);
  const [profileOf, setProfileOf] = useState<string | null>(null);
  const profileMember = room.members.find((member) => member.userId === profileOf) ?? null;

  const confirmed = flattenMessages(history.data);
  const newestIncomingId = confirmed.findLast((message) => message.senderId !== user.id)?.id;
  useReceiptAcks(room.id, newestIncomingId, scrollRef);
  const confirmedClientIds = new Set(confirmed.map((message) => message.clientId));
  // A send can fail on our end (lost response) after the server saved it. It's hidden
  // below once confirmed, but would sit in state forever with its image preview.
  const savedAfterFailing = sender.pending
    .filter((message) => message.status === "failed" && confirmedClientIds.has(message.clientId))
    .map((message) => message.clientId)
    .join();
  const { discard } = sender;
  useEffect(() => {
    for (const clientId of savedAfterFailing.split(",").filter(Boolean)) discard(clientId);
  }, [savedAfterFailing, discard]);
  const views: MessageView[] = [
    ...confirmed.map((message): MessageView => ({
      key: message.id,
      senderId: message.senderId,
      senderName: message.senderName ?? t("common.formerMember"),
      text: message.text,
      language: message.language,
      translation:
        message.language === user.preferredLanguage
          ? undefined
          : message.translations.find(({ language }) => language === user.preferredLanguage),
      images: message.attachments.map(({ url, width, height }) => ({ src: url, width, height })),
      createdAt: message.createdAt,
      status: "sent",
      delivery: message.senderId === user.id ? deliveryStatus(message, room.members) : undefined,
      deleted: message.deletedAt
        ? message.deletedBy === message.senderId
          ? "by-sender"
          : "by-moderator"
        : undefined,
      deletable: message.senderId === user.id || isModerator,
      replyTo: message.replyTo
        ? {
            id: message.replyTo.id,
            senderName: message.replyTo.senderName ?? t("common.formerMember"),
            text: message.replyTo.text,
            language: message.replyTo.language,
            hasImage: message.replyTo.hasImage,
            deleted: message.replyTo.deleted,
          }
        : undefined,
    })),
    // A pending message can be confirmed over the socket before its own request returns.
    ...sender.pending
      .filter((message) => !confirmedClientIds.has(message.clientId))
      .map((message): MessageView => ({
        key: message.clientId,
        senderId: user.id,
        senderName: user.displayName,
        text: message.text,
        language: user.preferredLanguage,
        images: message.image
          ? [
              {
                src: message.image.previewUrl,
                width: message.image.width ?? null,
                height: message.image.height ?? null,
              },
            ]
          : [],
        progress: message.progress,
        error: message.error,
        replyTo: message.replyTo,
        createdAt: message.createdAt,
        status: message.status,
      })),
  ];

  // A quote shows the replied-to message the way this viewer sees it, translation
  // included, whenever it's loaded; the server's preview (the original) otherwise.
  const loaded = new Map(views.map((view) => [view.key, view]));
  for (const view of views) {
    const quoted = view.replyTo && loaded.get(view.replyTo.id);
    if (quoted) view.replyTo = quoteOf(quoted);
  }

  // Not `[history]`: the query result is a new object every render, which would
  // rebuild the list's IntersectionObserver on every typing or presence event.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = history;
  const loadOlder = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  function send(text: string, image?: PendingImage) {
    sender.send(text, image, replyingTo ?? undefined);
    setReplyingTo(null);
    // In a column-reverse scroller, 0 is the bottom.
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        backTo="/rooms"
        leading={<Avatar name={room.name} src={room.avatarUrl ?? undefined} />}
        title={<span dir="auto">{room.name}</span>}
        subtitle={
          <Link to={`/rooms/${room.id}/settings`} className="hover:text-text">
            {t("nav.memberCount", { count: room.memberCount })}
            {othersOnline > 0 && (
              <>
                {" · "}
                <span className="inline-flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
                  {t("nav.online", { count: othersOnline })}
                </span>
              </>
            )}
          </Link>
        }
        actions={
          <>
            {isOwner && (
              <IconButton label={t("room.inviteSomeone")} onClick={() => setInviting(true)}>
                <UserPlus className="size-5" />
              </IconButton>
            )}
            <Link
              to={`/rooms/${room.id}/settings`}
              aria-label={t("room.settings")}
              title={t("room.settings")}
              className="inline-flex size-11 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              <Settings className="size-5" aria-hidden="true" />
            </Link>
          </>
        }
      />

      {history.isPending ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner label={t("room.loadingMessages")} />
        </div>
      ) : history.isError ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <EmptyState
            icon={MessageSquareOff}
            title={t("room.loadFailed")}
            description={t("room.loadFailedDescription")}
            action={<Button onClick={() => history.refetch()}>{t("common.tryAgain")}</Button>}
          />
        </div>
      ) : (
        <MessageList
          messages={views}
          currentUserId={user.id}
          hasOlder={history.hasNextPage}
          loadingOlder={history.isFetchingNextPage}
          onLoadOlder={loadOlder}
          onRetry={sender.retry}
          onReply={(key) => {
            const view = loaded.get(key);
            if (view) setReplyingTo(quoteOf(view));
          }}
          onDiscard={sender.discard}
          onInfo={(id) => {
            const message = confirmed.find((candidate) => candidate.id === id);
            if (message) setInfoFor({ id: message.id, text: message.text });
          }}
          onDelete={(id) => {
            remove.reset();
            setDeleting(id);
          }}
          profileAction={(senderId) =>
            room.members.some((member) => member.userId === senderId)
              ? () => setProfileOf(senderId)
              : undefined
          }
          avatarOf={(senderId) =>
            room.members.find((member) => member.userId === senderId)?.avatarUrl ?? undefined
          }
          scrollRef={scrollRef}
          empty={
            isOwner && alone ? (
              <EmptyState
                icon={UserPlus}
                title={t("room.invitePeople")}
                description={t("room.invitePeopleDescription")}
                action={
                  <Button onClick={() => setInviting(true)}>{t("room.inviteSomeone")}</Button>
                }
              />
            ) : (
              <EmptyState
                icon={MessagesSquare}
                title={t("room.emptyTitle")}
                description={t("room.emptyDescription")}
              />
            )
          }
        />
      )}

      <div aria-live="polite" className="min-h-6 px-4 text-xs text-text-muted md:px-8">
        <div className="mx-auto max-w-3xl">
          {!online || socket.status === "reconnecting" ? (
            <span className="inline-flex items-center gap-1.5">
              <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
              {online ? t("room.reconnecting") : t("room.offline")}
            </span>
          ) : (
            typingLabel(socket.typing, i18n)
          )}
        </div>
      </div>
      <Composer
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        onSend={send}
        onKeystroke={typingSignal.keystroke}
        onStopTyping={typingSignal.stop}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting && remove.mutate(deleting, { onSuccess: () => setDeleting(null) })
        }
        title={t("room.deleteMessageTitle")}
        description={t("room.deleteMessageDescription")}
        confirmLabel={t("common.delete")}
        pending={remove.isPending}
        error={remove.isError ? remove.error.message : null}
      />
      <MemberProfileDialog
        member={profileMember}
        online={socket.online.some((person) => person.userId === profileOf)}
        onClose={() => setProfileOf(null)}
      />
      <MessageInfoDialog roomId={room.id} message={infoFor} onClose={() => setInfoFor(null)} />
      {isOwner && (
        <InviteMemberDialog
          roomId={room.id}
          roomName={room.name}
          open={inviting}
          onClose={() => setInviting(false)}
        />
      )}
    </div>
  );
}

function quoteOf(view: MessageView): QuotedMessage {
  const translated = view.translation?.status === "done" && view.translation.text;
  return {
    id: view.key,
    senderName: view.senderName,
    text: translated || view.text,
    language: translated ? view.translation!.language : view.language,
    hasImage: view.images.length > 0,
    deleted: view.deleted !== undefined,
  };
}

function typingLabel(typing: TypingUser[], { t }: I18n): string | null {
  const [first, second] = typing;
  if (!first) return null;
  if (!second) return t("room.typingOne", { name: first.displayName });
  if (typing.length === 2) {
    return t("room.typingTwo", { name: first.displayName, other: second.displayName });
  }
  return t("room.typingMany");
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** The browser's own idea of being online: quicker and clearer than waiting on the socket. */
function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine);
}

export function RoomNotFound() {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 items-center justify-center">
      <EmptyState
        icon={MessageSquareOff}
        title={t("room.notFound")}
        description={t("room.notFoundDescription")}
        action={
          <Link to="/rooms" className="text-sm font-medium text-accent hover:text-accent-hover">
            {t("common.backToRooms")}
          </Link>
        }
      />
    </div>
  );
}
