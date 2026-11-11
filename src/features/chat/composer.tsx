import { ImagePlus, Reply, SendHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { imageTypes, mediaProblem } from "@shared/media.ts";
import { MESSAGE_MAX_LENGTH } from "@shared/messages.ts";

import { IconButton } from "@/components/ui/icon-button";
import { useI18n } from "@/lib/i18n";
import { imageSize } from "@/lib/upload";
import type { QuotedMessage } from "@/types/models";

import { QuoteBody } from "./message-bubble";
import type { PendingImage } from "./use-send-message";

export interface ComposerProps {
  /** The message the next send replies to, if any. */
  replyingTo?: QuotedMessage | null;
  onCancelReply?: () => void;
  onSend: (text: string, image?: PendingImage) => void;
  onKeystroke: () => void;
  onStopTyping: () => void;
}

/**
 * Enter sends, Shift+Enter adds a line, Escape cancels a reply. Grows with its
 * content up to a cap.
 */
export function Composer({
  replyingTo,
  onCancelReply,
  onSend,
  onKeystroke,
  onStopTyping,
}: ComposerProps) {
  const { t, format, error } = useI18n();
  const [text, setText] = useState("");
  const [image, setImage] = useState<PendingImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const latestPick = useRef(0);
  // The selected image's preview URL is ours until it's sent, so revoke it if we unmount.
  const imageRef = useRef(image);
  useEffect(() => {
    imageRef.current = image;
  }, [image]);
  useEffect(
    () => () => {
      latestPick.current += 1;
      revoke(imageRef.current);
    },
    [],
  );
  const trimmed = text.trim();

  // Picking "Reply" moves you straight to typing.
  const replyId = replyingTo?.id;
  useEffect(() => {
    if (replyId) textareaRef.current?.focus();
  }, [replyId]);
  const canSend = (Boolean(trimmed) || image !== null) && trimmed.length <= MESSAGE_MAX_LENGTH;

  function fitHeight(textarea: HTMLTextAreaElement) {
    textarea.style.height = "auto";
    // scrollHeight excludes the border; border-box height needs it or a scrollbar appears.
    const border = textarea.offsetHeight - textarea.clientHeight;
    if (textarea.value) textarea.style.height = `${textarea.scrollHeight + border}px`;
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    const problem = mediaProblem("attachment", file.type, file.size);
    setImageError(problem);
    if (problem) return;
    const pickId = ++latestPick.current;
    const size = await imageSize(file);
    // Picked again (or unmounted) while measuring: that pick wins.
    if (pickId !== latestPick.current) return;
    const previewUrl = URL.createObjectURL(file);
    setImage((previous) => {
      revoke(previous);
      return { file, previewUrl, ...size };
    });
    textareaRef.current?.focus();
  }

  function clearImage() {
    revoke(image);
    setImage(null);
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    // The preview URL now belongs to the pending message.
    onSend(trimmed, image ?? undefined);
    setImage(null);
    setImageError(null);
    onStopTyping();
    setText("");
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.value = "";
      fitHeight(textarea);
      textarea.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Ignore Enter while an IME (e.g. a Persian keyboard) is composing a character.
    // Safari reports isComposing false for the Enter that ends composition; keyCode 229 catches it.
    const composing = event.nativeEvent.isComposing || event.keyCode === 229;
    if (event.key === "Enter" && !event.shiftKey && !composing) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape" && replyingTo) {
      event.preventDefault();
      onCancelReply?.();
    }
  }

  return (
    <form
      onSubmit={submit}
      className="border-t border-border bg-surface px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {replyingTo && (
          <div className="flex items-center gap-3">
            <Reply className="size-5 shrink-0 text-accent rtl:-scale-x-100" aria-hidden="true" />
            <div className="flex min-w-0 flex-1 flex-col border-s-2 border-accent ps-3">
              <QuoteBody quote={replyingTo} lines={1} />
            </div>
            <IconButton label={t("chat.cancelReply")} onClick={onCancelReply}>
              <X className="size-5" />
            </IconButton>
          </div>
        )}
        {image && (
          <div className="flex items-center gap-3">
            <img
              src={image.previewUrl}
              alt={t("chat.selectedAttachment")}
              className="size-16 shrink-0 rounded-xl border border-border object-cover"
            />
            <span className="min-w-0 flex-1 text-xs text-text-muted">
              {t("chat.captionHint", { size: format.bytes(image.file.size) })}
            </span>
            <IconButton label={t("chat.removeImage")} onClick={clearImage}>
              <X className="size-5" />
            </IconButton>
          </div>
        )}
        {imageError && (
          <p role="alert" className="text-xs text-danger">
            {error(imageError)}
          </p>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={imageTypes.join(",")}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              void pick(event.target.files?.[0]);
              // Allow picking the same file again after removing it.
              event.target.value = "";
            }}
          />
          <IconButton
            label={t("chat.addImage")}
            onClick={() => fileRef.current?.click()}
            className="size-12 rounded-2xl"
          >
            <ImagePlus className="size-5" />
          </IconButton>
          <label htmlFor="composer" className="sr-only">
            {t("chat.message")}
          </label>
          <textarea
            ref={textareaRef}
            id="composer"
            rows={1}
            dir="auto"
            value={text}
            maxLength={MESSAGE_MAX_LENGTH}
            placeholder={image ? t("chat.captionPlaceholder") : t("chat.placeholder")}
            enterKeyHint="send"
            onChange={(event) => {
              setText(event.target.value);
              fitHeight(event.target);
              if (event.target.value) onKeystroke();
              else onStopTyping();
            }}
            onKeyDown={onKeyDown}
            onBlur={onStopTyping}
            className="max-h-40 min-h-12 min-w-0 flex-1 resize-none rounded-2xl border border-border bg-bg px-4 py-3 text-base text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          <IconButton
            type="submit"
            label={t("chat.send")}
            disabled={!canSend}
            className="size-12 rounded-2xl bg-accent text-on-accent hover:bg-accent-hover hover:text-on-accent"
          >
            <SendHorizontal className="size-5 rtl:-scale-x-100" />
          </IconButton>
        </div>
      </div>
    </form>
  );
}

function revoke(image: PendingImage | null) {
  if (image) URL.revokeObjectURL(image.previewUrl);
}
