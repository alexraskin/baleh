import { LogOut, ShieldMinus, ShieldPlus, Trash2, UserMinus, UserPlus, X } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router";

import type { RoomDetail, RoomMember } from "@shared/rooms.ts";
import { updateRoomSchema } from "@shared/rooms.ts";

import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormMessage } from "@/components/ui/form-message";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useFormErrors } from "@/features/auth/use-form-errors";
import { AvatarEditor } from "@/features/media/avatar-editor";
import { useCurrentUser } from "@/features/profile/use-current-user";
import { useI18n } from "@/lib/i18n";
import { useDocumentTitle } from "@/lib/use-document-title";

import { InviteMemberDialog } from "./invite-member-dialog";
import {
  useDeleteRoom,
  useLeaveRoom,
  useRemoveMember,
  useRevokeInvitation,
  useRoom,
  useRemoveRoomAvatar,
  useRoomInvitations,
  useSetMemberRole,
  useSetRoomAvatar,
  useUpdateRoom,
} from "./queries";
import { RoomNotFound } from "./room-page";

export function RoomSettingsPage() {
  const { roomId = "" } = useParams<{ roomId: string }>();
  const { t } = useI18n();
  const room = useRoom(roomId);
  useDocumentTitle(room.data ? t("roomSettings.pageTitle", { room: room.data.name }) : undefined);

  if (room.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (room.isError) return <RoomNotFound />;

  const isOwner = room.data.role === "owner";

  return (
    <div className="flex flex-1 flex-col bg-bg md:bg-surface">
      <PageHeader
        backTo={`/rooms/${room.data.id}`}
        title={t("room.settings")}
        subtitle={<span dir="auto">{room.data.name}</span>}
      />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-6 md:px-8 md:py-10">
        <DetailsSection room={room.data} isOwner={isOwner} />
        <MembersSection room={room.data} isOwner={isOwner} />
        {isOwner && <InvitationsSection roomId={room.data.id} />}
        <ExitSection room={room.data} isOwner={isOwner} />
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 id={id} className="text-sm font-medium text-text-muted">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function DetailsSection({ room, isOwner }: { room: RoomDetail; isOwner: boolean }) {
  const { t } = useI18n();
  const update = useUpdateRoom(room.id);
  const setAvatar = useSetRoomAvatar(room.id);
  const removeAvatar = useRemoveRoomAvatar(room.id);
  const { errors, validate } = useFormErrors(updateRoomSchema);
  const [saved, setSaved] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const values = validate(Object.fromEntries(new FormData(event.currentTarget)));
    if (!values) return;
    update.mutate(values, { onSuccess: () => setSaved(true) });
  }

  return (
    <Section id="room-details" title={t("roomSettings.details")}>
      <Card className="p-5">
        {isOwner ? (
          <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
            <AvatarEditor
              name={room.name}
              src={room.avatarUrl}
              purpose="roomAvatar"
              upload={setAvatar.mutateAsync}
              remove={removeAvatar.mutateAsync}
            />
            <Input
              label={t("rooms.roomName")}
              name="name"
              dir="auto"
              maxLength={80}
              autoComplete="off"
              defaultValue={room.name}
              error={errors.name}
            />
            <FormMessage>{update.isError ? update.error.message : null}</FormMessage>
            <div className="flex items-center justify-end gap-3">
              {saved && !update.isPending && (
                <output className="text-sm text-text-muted">{t("common.saved")}</output>
              )}
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? t("common.saving") : t("common.saveChanges")}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex items-center gap-4">
            <Avatar name={room.name} src={room.avatarUrl ?? undefined} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-medium text-text">
                <bdi>{room.name}</bdi>
              </p>
              <p className="text-sm text-text-muted">{t("roomSettings.onlyOwner")}</p>
            </div>
          </div>
        )}
      </Card>
    </Section>
  );
}

function MembersSection({ room, isOwner }: { room: RoomDetail; isOwner: boolean }) {
  const { t, error } = useI18n();
  const me = useCurrentUser();
  const remove = useRemoveMember(room.id);
  const setRole = useSetMemberRole(room.id);
  const isModerator = room.role !== "member";
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<RoomMember | null>(null);

  return (
    <Section
      id="room-members"
      title={t("roomSettings.members", { count: room.memberCount })}
      action={
        isOwner && (
          <Button variant="ghost" className="h-8 px-2.5" onClick={() => setInviting(true)}>
            <UserPlus className="size-4" aria-hidden="true" />
            {t("roomSettings.invite")}
          </Button>
        )
      }
    >
      <Card className="p-1.5">
        <ul className="flex flex-col">
          {room.members.map((member) => {
            const isMe = member.userId === me.id;
            return (
              <li key={member.userId} className="flex min-h-14 items-center gap-3 rounded-xl px-3">
                <Avatar name={member.displayName} src={member.avatarUrl ?? undefined} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">
                  <bdi>{member.displayName}</bdi>
                  {isMe && (
                    <span className="font-normal text-text-muted"> {t("roomSettings.you")}</span>
                  )}
                </span>
                {member.role !== "member" && (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-hover">
                    {member.role === "owner" ? t("roomSettings.owner") : t("roomSettings.admin")}
                  </span>
                )}
                {isModerator && !isMe && member.role === "member" && (
                  <IconButton
                    label={t("roomSettings.makeAdmin", { name: member.displayName })}
                    className="-me-2"
                    disabled={setRole.isPending}
                    onClick={() => setRole.mutate({ userId: member.userId, role: "admin" })}
                  >
                    <ShieldPlus className="size-4" />
                  </IconButton>
                )}
                {isOwner && member.role === "admin" && (
                  <IconButton
                    label={t("roomSettings.removeAdmin", { name: member.displayName })}
                    className="-me-2"
                    disabled={setRole.isPending}
                    onClick={() => setRole.mutate({ userId: member.userId, role: "member" })}
                  >
                    <ShieldMinus className="size-4" />
                  </IconButton>
                )}
                {!isMe &&
                  (isOwner ? member.role !== "owner" : isModerator && member.role === "member") && (
                    <IconButton
                      label={t("roomSettings.removeMember", { name: member.displayName })}
                      className="-me-2"
                      onClick={() => {
                        remove.reset();
                        setRemoving(member);
                      }}
                    >
                      <UserMinus className="size-4" />
                    </IconButton>
                  )}
              </li>
            );
          })}
        </ul>
        {setRole.isError && (
          <p role="alert" className="px-3 pb-2 text-xs text-danger">
            {error(setRole.error.message)}
          </p>
        )}
        {room.memberCount === 1 && (
          <p className="px-3 pt-1 pb-3 text-sm text-text-muted">
            {isOwner ? t("roomSettings.justYouOwner") : t("roomSettings.everyoneLeft")}
          </p>
        )}
      </Card>

      {isOwner && (
        <InviteMemberDialog
          roomId={room.id}
          roomName={room.name}
          open={inviting}
          onClose={() => setInviting(false)}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() =>
          removing && remove.mutate(removing.userId, { onSuccess: () => setRemoving(null) })
        }
        title={t("roomSettings.removeTitle", { name: removing?.displayName ?? "" })}
        description={t("roomSettings.removeDescription")}
        confirmLabel={t("common.remove")}
        pending={remove.isPending}
        error={remove.isError ? remove.error.message : null}
      />
    </Section>
  );
}

function InvitationsSection({ roomId }: { roomId: string }) {
  const { t, format } = useI18n();
  const invitations = useRoomInvitations(roomId, true);
  const revoke = useRevokeInvitation(roomId);

  return (
    <Section id="room-invitations" title={t("roomSettings.pendingInvitations")}>
      <Card className="p-1.5">
        {invitations.isPending ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : invitations.isError ? (
          <p role="alert" className="px-3 py-3 text-sm text-text-muted">
            {t("roomSettings.invitationsFailed")}
          </p>
        ) : invitations.data.length === 0 ? (
          <p className="px-3 py-3 text-sm text-text-muted">{t("roomSettings.noPending")}</p>
        ) : (
          <ul className="flex flex-col">
            {invitations.data.map((invitation) => (
              <li key={invitation.id} className="flex min-h-14 items-center gap-3 rounded-xl px-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-text">
                    <bdi>{invitation.email}</bdi>
                  </span>
                  <span className="text-xs text-text-muted">
                    {t("roomSettings.expires", {
                      date: format.relativeDay(invitation.expiresAt),
                    })}
                  </span>
                </span>
                <IconButton
                  label={t("roomSettings.cancelInvitation", { email: invitation.email })}
                  className="-me-2"
                  disabled={revoke.isPending && revoke.variables === invitation.id}
                  onClick={() => revoke.mutate(invitation.id)}
                >
                  <X className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <FormMessage>{revoke.isError ? revoke.error.message : null}</FormMessage>
    </Section>
  );
}

function ExitSection({ room, isOwner }: { room: RoomDetail; isOwner: boolean }) {
  const { t } = useI18n();
  const leave = useLeaveRoom(room.id);
  const remove = useDeleteRoom(room.id);
  const [confirming, setConfirming] = useState<"leave" | "delete" | null>(null);

  const leaveDescription =
    room.memberCount === 1
      ? t("roomSettings.leaveOnlyMember")
      : isOwner
        ? t("roomSettings.leaveOwner")
        : t("roomSettings.leaveMember");

  return (
    <Section
      id="room-exit"
      title={isOwner ? t("roomSettings.leaveOrDelete") : t("roomSettings.leave")}
    >
      <Card className="flex flex-col gap-1 p-1.5">
        <button
          type="button"
          onClick={() => {
            leave.reset();
            setConfirming("leave");
          }}
          className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-start text-sm text-text hover:bg-surface-2"
        >
          <LogOut className="size-4 text-text-muted rtl:-scale-x-100" aria-hidden="true" />
          {t("roomSettings.leaveRoom")}
        </button>
        {isOwner && (
          <button
            type="button"
            onClick={() => {
              remove.reset();
              setConfirming("delete");
            }}
            className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-start text-sm text-danger hover:bg-danger/8"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            {t("roomSettings.deleteRoom")}
          </button>
        )}
      </Card>

      <ConfirmDialog
        open={confirming === "leave"}
        onClose={() => setConfirming(null)}
        onConfirm={() => leave.mutate()}
        title={t("roomSettings.leaveTitle")}
        description={leaveDescription}
        confirmLabel={t("roomSettings.leave")}
        pending={leave.isPending}
        error={leave.isError ? leave.error.message : null}
      />
      <ConfirmDialog
        open={confirming === "delete"}
        onClose={() => setConfirming(null)}
        onConfirm={() => remove.mutate()}
        title={t("roomSettings.deleteTitle")}
        description={t("roomSettings.deleteDescription")}
        confirmLabel={t("roomSettings.deleteRoom")}
        pending={remove.isPending}
        error={remove.isError ? remove.error.message : null}
      />
    </Section>
  );
}
