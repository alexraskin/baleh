import type { ReactNode } from "react";

import { useI18n } from "@/lib/i18n";

import { Button } from "./button";
import { Dialog } from "./dialog";
import { FormMessage } from "./form-message";

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pending?: boolean;
  error?: string | null;
  tone?: "danger" | "primary";
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  pending = false,
  error,
  tone = "danger",
}: ConfirmDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      <FormMessage>{error}</FormMessage>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button variant={tone} onClick={onConfirm} disabled={pending}>
          {pending ? t("common.working") : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
