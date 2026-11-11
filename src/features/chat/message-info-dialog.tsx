import type { MessageReceipt } from "@shared/messages.ts";

import { Avatar } from "@/components/ui/avatar";
import { Dialog } from "@/components/ui/dialog";
import { FormMessage } from "@/components/ui/form-message";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n";

import { Ticks } from "./message-bubble";
import { useMessageInfo } from "./queries";

export interface MessageInfoDialogProps {
  roomId: string;
  /** The message to show, or null when closed. */
  message: { id: string; text: string } | null;
  onClose: () => void;
}

/** Who has received and read one of your messages, and when. */
export function MessageInfoDialog({ roomId, message, onClose }: MessageInfoDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog open={message !== null} onClose={onClose} title={t("chat.infoTitle")}>
      {message && <MessageInfo roomId={roomId} message={message} />}
    </Dialog>
  );
}

function MessageInfo({
  roomId,
  message,
}: {
  roomId: string;
  message: { id: string; text: string };
}) {
  const { t } = useI18n();
  const info = useMessageInfo(roomId, message.id);

  return (
    <div className="flex flex-col gap-5">
      <p
        dir="auto"
        className="line-clamp-4 self-end rounded-bubble rounded-ee-md bg-bubble-out px-4 py-2.5 whitespace-pre-wrap text-text"
      >
        {message.text}
      </p>
      {info.isPending ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : info.isError ? (
        <FormMessage>{t("chat.infoFailed")}</FormMessage>
      ) : info.data.length === 0 ? (
        <p className="text-sm text-text-muted">{t("chat.infoNobody")}</p>
      ) : (
        <>
          <ReceiptGroup
            title={t("chat.readBy")}
            status="read"
            receipts={info.data.filter((receipt) => receipt.readAt)}
            time={(receipt) => receipt.readAt}
          />
          <ReceiptGroup
            title={t("chat.deliveredTo")}
            status="delivered"
            receipts={info.data.filter((receipt) => receipt.deliveredAt && !receipt.readAt)}
            time={(receipt) => receipt.deliveredAt}
          />
          <ReceiptGroup
            title={t("chat.notDelivered")}
            status="sent"
            receipts={info.data.filter((receipt) => !receipt.deliveredAt)}
            time={() => null}
          />
        </>
      )}
    </div>
  );
}

function ReceiptGroup({
  title,
  status,
  receipts,
  time,
}: {
  title: string;
  status: "read" | "delivered" | "sent";
  receipts: MessageReceipt[];
  time: (receipt: MessageReceipt) => string | null;
}) {
  const { format } = useI18n();
  if (receipts.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
        <Ticks status={status} />
        {title}
      </h3>
      <ul className="flex flex-col">
        {receipts.map((receipt) => {
          const at = time(receipt);
          return (
            <li key={receipt.userId} className="flex min-h-12 items-center gap-3">
              <Avatar name={receipt.displayName} src={receipt.avatarUrl ?? undefined} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm text-text">
                <bdi>{receipt.displayName}</bdi>
              </span>
              {at && (
                <time
                  dateTime={at}
                  title={format.full(at)}
                  className="shrink-0 text-xs text-text-muted"
                >
                  {format.dayTime(at)}
                </time>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
