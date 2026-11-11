import { useEffect, useRef, type RefObject } from "react";

import { postReceipts } from "./queries";

/** How close to the newest message the reader must be scrolled for it to count as read. */
const READ_THRESHOLD_PX = 120;

/**
 * Acknowledges messages from others as they arrive: delivered as soon as
 * they're in the cache, read once they're on screen in a focused, visible tab
 * with the conversation scrolled to the bottom, like WhatsApp.
 */
export function useReceiptAcks(
  roomId: string,
  newestIncomingId: string | undefined,
  scrollRef: RefObject<HTMLDivElement | null>,
) {
  const acked = useRef<{ delivered?: string; read?: string }>({});

  useEffect(() => {
    if (!newestIncomingId) return;
    const id = newestIncomingId;

    function isBeingRead() {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return false;
      // The list scrolls in reverse, so 0 is the bottom and older messages are negative.
      const scroller = scrollRef.current;
      return !scroller || scroller.scrollTop > -READ_THRESHOLD_PX;
    }

    function acknowledge() {
      const read = isBeingRead() && acked.current.read !== id ? id : undefined;
      const delivered = !read && acked.current.delivered !== id ? id : undefined;
      if (!read && !delivered) return;

      const previous = { ...acked.current };
      acked.current = read ? { delivered: id, read: id } : { ...previous, delivered: id };
      postReceipts(roomId, read ? { read } : { delivered }).catch(() => {
        // Try again on the next trigger; the server ignores anything stale.
        acked.current = previous;
      });
    }

    acknowledge();
    const scroller = scrollRef.current;
    window.addEventListener("focus", acknowledge);
    document.addEventListener("visibilitychange", acknowledge);
    scroller?.addEventListener("scroll", acknowledge, { passive: true });
    return () => {
      window.removeEventListener("focus", acknowledge);
      document.removeEventListener("visibilitychange", acknowledge);
      scroller?.removeEventListener("scroll", acknowledge);
    };
  }, [roomId, newestIncomingId, scrollRef]);
}
