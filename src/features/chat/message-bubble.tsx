import {
  Ban,
  Check,
  Clock3,
  Copy,
  Image as ImageIcon,
  ImageOff,
  Languages,
  Reply,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";

import type { DeliveryStatus } from "@shared/messages.ts";
import { splitLinks, textDirection } from "@shared/text.ts";

import { IconButton } from "@/components/ui/icon-button";
import { directionOf, type LanguageCode } from "@/config/i18n";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import type { MessageView, QuotedMessage } from "@/types/models";

export interface MessageBubbleProps {
  message: MessageView;
  outgoing: boolean;
  /** Hide the sender name when the previous message came from the same person. */
  showSender: boolean;
  onRetry?: () => void;
  onDiscard?: () => void;
  /** Starts a reply to this message in the composer. */
  onReply?: () => void;
  /** Scrolls to the message a reply quotes. */
  onJumpToQuote?: (id: string) => void;
  /** Opens "Message info" for your own sent messages. */
  onInfo?: () => void;
  /** Asks to delete the message; shown when it's deletable. */
  onDelete?: () => void;
  /** Opens the sender's profile; the name is plain text without it (e.g. former members). */
  onSender?: () => void;
}

export function MessageBubble(props: MessageBubbleProps) {
  const { message, outgoing, showSender, onSender } = props;
  const { t } = useI18n();
  if (message.deleted) {
    return (
      <div className={cn("flex flex-col gap-1", outgoing ? "items-end" : "items-start")}>
        {showSender && !outgoing && <SenderName name={message.senderName} onClick={onSender} />}
        <p className="inline-flex items-center gap-1.5 rounded-bubble border border-border px-4 py-2.5 text-sm text-text-muted italic">
          <Ban className="size-3.5" aria-hidden="true" />
          {message.deleted === "by-moderator"
            ? t("chat.deletedByModerator")
            : t("chat.deletedBySender")}
        </p>
      </div>
    );
  }
  return <LiveBubble {...props} />;
}

function LiveBubble({
  message,
  outgoing,
  showSender,
  onRetry,
  onDiscard,
  onReply,
  onJumpToQuote,
  onInfo,
  onDelete,
  onSender,
}: MessageBubbleProps) {
  const { t, format, error } = useI18n();
  const [showOriginal, setShowOriginal] = useState(false);
  const { translation } = message;
  const translated = translation?.status === "done" && translation.text ? translation.text : null;
  // The translation by default; the original on request, or when there's no translation.
  const shown =
    translated && !showOriginal
      ? { text: translated, language: translation!.language, isTranslation: true }
      : { text: message.text, language: message.language, isTranslation: false };
  const [viewing, setViewing] = useState<string | null>(null);
  // Actions show on hover, keyboard focus, or a tap on the bubble (touch has no hover).
  const [actionsOpen, setActionsOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!actionsOpen) return;
    const close = (event: PointerEvent) => {
      if (!rowRef.current?.contains(event.target as Node)) setActionsOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [actionsOpen]);
  const hasImages = message.images.length > 0;

  return (
    <div
      ref={rowRef}
      className={cn("group flex flex-col gap-1", outgoing ? "items-end" : "items-start")}
    >
      {showSender && !outgoing && <SenderName name={message.senderName} onClick={onSender} />}
      {/* Keyboard users reach the actions by tabbing (:focus-visible); the tap is a touch shortcut. */}
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        onClick={(event) => {
          if (!(event.target as Element).closest("a, button")) setActionsOpen((open) => !open);
        }}
        className={cn(
          "max-w-[min(80%,34rem)] min-w-0 rounded-bubble transition-opacity",
          hasImages ? "flex flex-col gap-1.5 p-1.5" : "px-4 py-2.5",
          outgoing ? "rounded-ee-md bg-bubble-out" : "rounded-es-md bg-bubble-in",
          message.status === "sending" && !hasImages && "opacity-70",
          message.status === "failed" && "ring-1 ring-danger/40",
        )}
      >
        {message.replyTo && (
          <QuoteButton
            quote={message.replyTo}
            onClick={() => onJumpToQuote?.(message.replyTo!.id)}
            className={hasImages ? undefined : "mb-1.5"}
          />
        )}
        {message.images.map((image) => (
          <MessageImage
            key={image.src}
            {...image}
            alt={shown.text || t("chat.sentBy", { name: message.senderName })}
            progress={message.status === "sending" ? message.progress : undefined}
            onOpen={message.status === "sent" ? () => setViewing(image.src) : undefined}
          />
        ))}
        {shown.text && (
          <MessageText
            text={shown.text}
            language={shown.language}
            className={hasImages ? "px-2.5 pb-1" : undefined}
          />
        )}
      </div>
      <ImageViewer
        src={viewing}
        onClose={() => setViewing(null)}
        title={t("chat.photoFrom", { name: message.senderName })}
        alt={shown.text || t("chat.sentBy", { name: message.senderName })}
      />
      <div
        className={cn(
          "flex items-center gap-2 px-3 text-xs whitespace-nowrap text-text-muted",
          outgoing && "flex-row-reverse",
        )}
      >
        {message.status === "sending" ? (
          <span className="inline-flex items-center gap-1" aria-live="polite">
            <Clock3 className="size-3.5" aria-hidden="true" />
            {message.progress !== undefined && message.progress < 1
              ? t("common.uploading", { percent: format.percent(message.progress) })
              : t("chat.sending")}
          </span>
        ) : message.status === "failed" ? (
          <span className="flex items-center gap-2">
            <span role="alert" className="text-danger">
              {message.error ? error(message.error) : t("chat.notSent")}
            </span>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={onRetry} className="min-h-6 font-medium hover:text-text">
              {t("chat.retry")}
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={onDiscard} className="min-h-6 hover:text-text">
              {t("chat.discard")}
            </button>
          </span>
        ) : outgoing && message.delivery ? (
          <button
            type="button"
            onClick={onInfo}
            aria-label={t("chat.sentInfo", {
              time: format.time(message.createdAt),
              status: t(`chat.status.${message.delivery}`),
            })}
            title={format.full(message.createdAt)}
            className="inline-flex min-h-6 items-center gap-1 rounded hover:text-text"
          >
            <time dateTime={message.createdAt}>{format.time(message.createdAt)}</time>
            <Ticks status={message.delivery} />
          </button>
        ) : (
          <time dateTime={message.createdAt} title={format.full(message.createdAt)}>
            {format.time(message.createdAt)}
          </time>
        )}
        {message.status === "sent" && translation?.status === "pending" && (
          <>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 motion-safe:animate-pulse">
              <Languages className="size-3.5" aria-hidden="true" />
              {t("chat.translating")}
            </span>
          </>
        )}
        {message.status === "sent" && translation?.status === "failed" && (
          <>
            <span aria-hidden="true">·</span>
            <span
              className="inline-flex items-center gap-1 text-danger"
              title={t("chat.translateFailedTitle", {
                language: format.language(message.language),
              })}
            >
              <Languages className="size-3.5" aria-hidden="true" />
              {t("chat.translateFailed")}
            </span>
          </>
        )}
        {translated && (
          <button
            type="button"
            onClick={() => setShowOriginal((value) => !value)}
            aria-pressed={showOriginal}
            aria-label={t(showOriginal ? "chat.showTranslation" : "chat.showOriginal")}
            title={t("chat.translatedFrom", { language: format.language(message.language) })}
            className={cn(
              "inline-flex min-h-6 min-w-6 items-center justify-center rounded hover:text-text",
              showOriginal && "text-accent",
            )}
          >
            <Languages className="size-3.5" aria-hidden="true" />
          </button>
        )}
        <span
          className={cn(
            "flex items-center gap-2 opacity-0 transition-opacity pointer-events-none group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100",
            actionsOpen && "pointer-events-auto opacity-100",
          )}
        >
          {message.status === "sent" && shown.text && (
            <CopyButton
              text={shown.text}
              label={
                translated
                  ? t(shown.isTranslation ? "chat.copyTranslation" : "chat.copyOriginal")
                  : t("common.copy")
              }
            />
          )}
          {message.status === "sent" && onReply && (
            <button
              type="button"
              onClick={onReply}
              aria-label={t("chat.reply")}
              title={t("chat.reply")}
              className="inline-flex min-h-6 min-w-6 items-center justify-center rounded hover:text-text"
            >
              <Reply className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
            </button>
          )}
          {message.status === "sent" && message.deletable && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={t("chat.deleteMessage")}
              title={t("chat.deleteMessage")}
              className="inline-flex min-h-6 min-w-6 items-center justify-center rounded hover:text-danger"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

function SenderName({ name, onClick }: { name: string; onClick?: () => void }) {
  const { t } = useI18n();
  if (!onClick) {
    return (
      <span className="px-3 text-xs font-medium text-text-muted">
        <bdi>{name}</bdi>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("chat.viewProfile", { name })}
      className="min-h-6 rounded px-3 text-xs font-medium text-text-muted hover:text-text hover:underline"
    >
      <bdi>{name}</bdi>
    </button>
  );
}

/**
 * Message text, one block per line. Each line takes its own direction, so a
 * Persian line and an English line in one message both read naturally, and
 * links are clickable and kept left to right inside Persian sentences.
 */
function MessageText({
  text,
  language,
  className,
}: {
  text: string;
  language: LanguageCode;
  className?: string;
}) {
  const fallback = directionOf(language);
  return (
    <p lang={language} className={cn("break-words whitespace-pre-wrap text-text", className)}>
      {text.split("\n").map((line, index) => (
        // Lines never reorder, so their position is a stable key.
        // oxlint-disable-next-line react/no-array-index-key
        <span key={index} dir={textDirection(line, fallback)} className="block">
          {line ? (
            splitLinks(line).map((part, partIndex) =>
              part.href ? (
                <a
                  // oxlint-disable-next-line react/no-array-index-key
                  key={partIndex}
                  href={part.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  dir="ltr"
                  className="wrap-anywhere text-accent-hover underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
                >
                  {part.text}
                </a>
              ) : (
                part.text
              ),
            )
          ) : (
            <br />
          )}
        </span>
      ))}
    </p>
  );
}

/** The quoted message at the top of a reply. Tapping it scrolls to the original. */
function QuoteButton({
  quote,
  onClick,
  className,
}: {
  quote: QuotedMessage;
  onClick: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("chat.replyingTo", { name: quote.senderName })}
      className={cn(
        "flex w-full min-w-0 flex-col items-start rounded-xl border-s-2 border-accent bg-text/5 px-3 py-1.5 text-start hover:bg-text/10",
        className,
      )}
    >
      <QuoteBody quote={quote} />
    </button>
  );
}

/** Sender and a line or two of the quoted message. Shared with the composer's reply bar. */
export function QuoteBody({ quote, lines = 2 }: { quote: QuotedMessage; lines?: 1 | 2 }) {
  const { t, dir } = useI18n();
  const text = quote.deleted ? "" : quote.text;
  return (
    <>
      <span className="text-xs font-medium text-accent">
        <bdi>{quote.senderName}</bdi>
      </span>
      <span
        lang={text ? quote.language : undefined}
        dir={text ? textDirection(text, directionOf(quote.language)) : dir}
        className={cn(
          "w-full text-start text-sm break-words text-text-muted",
          lines === 1 ? "line-clamp-1" : "line-clamp-2",
        )}
      >
        {quote.deleted ? (
          <span className="italic">{t("chat.deletedMessage")}</span>
        ) : quote.text ? (
          quote.text
        ) : quote.hasImage ? (
          <span className="inline-flex items-center gap-1">
            <ImageIcon className="size-3.5" aria-hidden="true" />
            {t("chat.photo")}
          </span>
        ) : null}
      </span>
    </>
  );
}

/**
 * A chat image. Its box is sized from the stored dimensions before it loads, with
 * the aspect ratio clamped so a panorama or a sliver can't stretch the conversation.
 */
function MessageImage({
  src,
  width,
  height,
  alt,
  progress,
  onOpen,
}: {
  src: string;
  alt: string;
  width: number | null;
  height: number | null;
  progress?: number;
  onOpen?: () => void;
}) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const ratio = width && height ? Math.min(2, Math.max(0.5, width / height)) : 4 / 3;
  const box =
    "relative block w-72 max-w-full overflow-hidden rounded-[calc(var(--radius-bubble)-0.375rem)] bg-surface-2";

  const content = failed ? (
    <span className="flex size-full items-center justify-center gap-1.5 text-xs text-text-muted">
      <ImageOff className="size-4" aria-hidden="true" />
      {t("chat.imageUnavailable")}
    </span>
  ) : (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="size-full object-cover"
    />
  );

  return (
    <div className={box} style={{ aspectRatio: ratio }}>
      {onOpen && !failed ? (
        <button type="button" onClick={onOpen} title={t("chat.viewFullSize")} className="size-full">
          {content}
        </button>
      ) : (
        content
      )}
      {progress !== undefined && (
        <progress
          aria-label={t("chat.uploadingLabel")}
          value={progress}
          max={1}
          className="absolute inset-x-3 bottom-3 h-1.5 w-[calc(100%-1.5rem)] appearance-none overflow-hidden rounded-full [&::-moz-progress-bar]:bg-accent [&::-webkit-progress-bar]:bg-surface/70 [&::-webkit-progress-value]:bg-accent"
        />
      )}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => setCopied(false),
        )
      }
      aria-label={copied ? t("common.copied") : label}
      title={label}
      className="inline-flex min-h-6 min-w-6 items-center justify-center rounded hover:text-text"
    >
      {copied ? (
        <Check className="size-3.5 text-accent" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
    </button>
  );
}

/** WhatsApp-style ticks: one grey (sent), two grey (delivered), two blue (read). */
export function Ticks({ status, className }: { status: DeliveryStatus; className?: string }) {
  const cls = cn("size-4", status === "read" ? "text-receipt-read" : "text-text-muted", className);
  if (status === "sent") return <Check aria-hidden="true" strokeWidth={2.25} className={cls} />;
  // Lucide's CheckCheck draws the second tick shorter, which reads as "one and a half";
  // these are two equal ticks.
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cls}
    >
      <path d="M1.5 12.5 6 17 16 7" />
      <path d="M22.5 7 12.5 17 11 15.5" />
    </svg>
  );
}

/**
 * Photo viewer on the native `<dialog>` (focus trap, Escape, inert page). Styled like an
 * image bubble; a click on the backdrop closes it.
 */
const ZOOM = 2.5;

function ImageViewer({
  src,
  title,
  alt,
  onClose,
}: {
  src: string | null;
  title: string;
  alt: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  // The fitted size, kept as the frame size while zoomed, and the point to zoom into (0-1).
  const [zoom, setZoom] = useState<{ width: number; height: number; x: number; y: number } | null>(
    null,
  );
  useEffect(() => {
    const dialog = ref.current;
    if (src && !dialog?.open) dialog?.showModal();
    if (!src && dialog?.open) dialog.close();
  }, [src]);
  // Centre the tapped point once the zoomed image has laid out.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!zoom || !frame) return;
    frame.scrollLeft = zoom.x * zoom.width * ZOOM - zoom.width / 2;
    frame.scrollTop = zoom.y * zoom.height * ZOOM - zoom.height / 2;
  }, [zoom]);

  const toggleZoom = (event: MouseEvent<HTMLButtonElement>) => {
    if (zoom) return setZoom(null);
    const rect = event.currentTarget.getBoundingClientRect();
    // Keyboard activation has no pointer position (detail 0): zoom into the centre.
    const pointer = event.detail > 0;
    setZoom({
      width: rect.width,
      height: rect.height,
      x: pointer ? (event.clientX - rect.left) / rect.width : 0.5,
      y: pointer ? (event.clientY - rect.top) / rect.height : 0.5,
    });
  };

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      aria-label={title}
      onClose={() => {
        setZoom(null);
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      // Padding on the inner div, so a click on it doesn't count as a backdrop click.
      className="m-auto max-w-[min(56rem,calc(100%-2rem))] rounded-bubble bg-surface p-0 text-text shadow-soft backdrop:bg-text/25"
    >
      {src && (
        <div className="flex flex-col p-1.5">
          {/* ltr so scrollLeft math doesn't flip in RTL. */}
          <div
            ref={frameRef}
            dir="ltr"
            className={cn(
              "overflow-hidden rounded-[calc(var(--radius-bubble)-0.375rem)]",
              zoom && "overflow-auto overscroll-contain",
            )}
            style={zoom ? { width: zoom.width, height: zoom.height } : undefined}
          >
            <button
              type="button"
              aria-label={zoom ? t("chat.zoomOut") : t("chat.zoomIn")}
              onClick={toggleZoom}
              className={cn("block", zoom ? "cursor-zoom-out" : "cursor-zoom-in")}
            >
              <img
                src={src}
                alt={alt}
                className={zoom ? "max-w-none" : "max-h-[75dvh] max-w-full object-contain"}
                style={zoom ? { width: zoom.width * ZOOM } : undefined}
              />
            </button>
          </div>
          <div className="flex items-center gap-2 ps-2.5">
            <p className="min-w-0 flex-1 truncate text-sm text-text-muted">
              <bdi>{title}</bdi>
            </p>
            <IconButton label={t("common.close")} onClick={onClose}>
              <X className="size-5" />
            </IconButton>
          </div>
        </div>
      )}
    </dialog>
  );
}
