import type { FormEvent } from "react";
import { useNavigate } from "react-router";

import { createRoomSchema } from "@shared/rooms.ts";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { useFormErrors } from "@/features/auth/use-form-errors";
import { useI18n } from "@/lib/i18n";

import { useCreateRoom } from "./queries";

export function CreateRoomDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("nav.newRoom")}
      description={t("rooms.createDescription")}
    >
      <CreateRoomForm onDone={onClose} />
    </Dialog>
  );
}

function CreateRoomForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const create = useCreateRoom();
  const navigate = useNavigate();
  const { errors, validate } = useFormErrors(createRoomSchema);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = validate(Object.fromEntries(new FormData(event.currentTarget)));
    if (!values) return;
    create.mutate(values, {
      onSuccess: (room) => {
        onDone();
        navigate(`/rooms/${room.id}`);
      },
    });
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      <Input
        label={t("rooms.roomName")}
        name="name"
        placeholder={t("rooms.roomNamePlaceholder")}
        dir="auto"
        maxLength={80}
        autoComplete="off"
        data-autofocus
        error={errors.name}
      />
      <FormMessage>{create.isError ? create.error.message : null}</FormMessage>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? t("rooms.creating") : t("rooms.createRoom")}
        </Button>
      </div>
    </form>
  );
}
