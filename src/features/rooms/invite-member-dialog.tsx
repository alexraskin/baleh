import { Check, Copy } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { CreatedInvitation } from "@shared/rooms.ts";
import { createInvitationSchema } from "@shared/rooms.ts";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { useFormErrors } from "@/features/auth/use-form-errors";
import { useI18n } from "@/lib/i18n";

import { useCreateInvitation } from "./queries";

export interface InviteMemberDialogProps {
  roomId: string;
  roomName: string;
  open: boolean;
  onClose: () => void;
}

export function InviteMemberDialog({ roomId, roomName, open, onClose }: InviteMemberDialogProps) {
  const { t } = useI18n();
  const [created, setCreated] = useState<CreatedInvitation | null>(null);

  function close() {
    setCreated(null);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={created ? t("invite.readyTitle") : t("invite.title", { room: roomName })}
      description={created ? t("invite.share", { email: created.email }) : t("invite.description")}
    >
      {created ? (
        <InviteLink invitation={created} onAnother={() => setCreated(null)} onDone={close} />
      ) : (
        <InviteForm roomId={roomId} onCreated={setCreated} onCancel={close} />
      )}
    </Dialog>
  );
}

function InviteForm({
  roomId,
  onCreated,
  onCancel,
}: {
  roomId: string;
  onCreated: (invitation: CreatedInvitation) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const invite = useCreateInvitation(roomId);
  const { errors, validate } = useFormErrors(createInvitationSchema);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = validate(Object.fromEntries(new FormData(event.currentTarget)));
    if (!values) return;
    invite.mutate(values.email, { onSuccess: onCreated });
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      <Input
        label={t("common.email")}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="off"
        placeholder={t("invite.emailPlaceholder")}
        dir="ltr"
        data-autofocus
        error={errors.email}
      />
      <FormMessage>{invite.isError ? invite.error.message : null}</FormMessage>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={invite.isPending}>
          {invite.isPending ? t("invite.inviting") : t("invite.send")}
        </Button>
      </div>
    </form>
  );
}

function InviteLink({
  invitation,
  onAnother,
  onDone,
}: {
  invitation: CreatedInvitation;
  onAnother: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(invitation.inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-bg p-1.5 ps-4">
        <input
          readOnly
          aria-label={t("invite.linkLabel")}
          dir="ltr"
          value={invitation.inviteUrl}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 bg-transparent text-sm text-text focus:outline-none"
        />
        <Button variant="secondary" onClick={copy} className="shrink-0">
          {copied ? (
            <Check className="size-4 text-accent" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
          <span aria-live="polite">{copied ? t("common.copied") : t("common.copy")}</span>
        </Button>
      </div>
      <p className="text-xs text-text-muted">{t("invite.linkExpiry")}</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onAnother}>
          {t("invite.another")}
        </Button>
        <Button onClick={onDone}>{t("common.done")}</Button>
      </div>
    </div>
  );
}
