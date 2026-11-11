import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";

import { IconButton } from "./icon-button";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/**
 * Modal built on the native `<dialog>`, which provides focus trapping, Escape
 * to close and an inert background. Content mounts only while open, so forms
 * inside start fresh each time. Mark the field to focus with `data-autofocus`.
 */
export function Dialog({ open, onClose, title, description, children, className }: DialogProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal() focuses the first focusable element (the close button), so
      // move focus to the field marked for it. React doesn't render `autofocus`.
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // Clicks on the backdrop land on the dialog element itself. Escape covers keyboard users.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-border bg-surface p-0 text-text shadow-soft",
        "backdrop:bg-text/25",
        className,
      )}
    >
      {open && (
        <div className="flex flex-col gap-5 p-6">
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 id={titleId} className="text-lg font-semibold text-text">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="text-sm text-text-muted">
                  {description}
                </p>
              )}
            </div>
            <IconButton label={t("common.close")} onClick={onClose} className="-me-2 -mt-2">
              <X className="size-5" />
            </IconButton>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
