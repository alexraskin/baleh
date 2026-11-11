import { Mail } from "lucide-react";
import { useNavigate } from "react-router";

import type { ReceivedInvitation } from "@shared/rooms.ts";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";

import { useAcceptInvitation, useDeclineInvitation, useMyInvitations } from "./queries";

/** Invitations waiting for the signed-in user. Renders nothing when there are none. */
export function PendingInvitations({ className }: { className?: string }) {
  const { t } = useI18n();
  const { data: invitations } = useMyInvitations();
  if (!invitations?.length) return null;

  return (
    <section aria-labelledby="pending-invitations" className={cn("flex flex-col gap-2", className)}>
      <h2
        id="pending-invitations"
        className="px-3 text-xs font-medium tracking-wide text-text-muted uppercase"
      >
        {t("invite.heading")}
      </h2>
      <ul className="flex flex-col gap-2">
        {invitations.map((invitation) => (
          <li key={invitation.id}>
            <InvitationCard invitation={invitation} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function InvitationCard({ invitation }: { invitation: ReceivedInvitation }) {
  const { t, rich, error } = useI18n();
  const navigate = useNavigate();
  const accept = useAcceptInvitation();
  const decline = useDeclineInvitation();
  const busy = accept.isPending || decline.isPending;
  const failed = accept.isError || decline.isError;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Mail className="size-4" aria-hidden="true" />
        </span>
        <p className="min-w-0 text-sm text-text">
          {rich("invite.invitedYou", {
            name: (
              <bdi className="font-medium">{invitation.inviterName ?? t("common.someone")}</bdi>
            ),
            room: <bdi className="font-medium break-words">{invitation.roomName}</bdi>,
          })}
        </p>
      </div>
      {failed && (
        <p role="alert" className="text-xs text-danger">
          {error((accept.error ?? decline.error)?.message ?? "")}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          className="h-9 flex-1"
          disabled={busy}
          onClick={() =>
            accept.mutate(invitation.id, {
              onSuccess: ({ roomId }) => navigate(`/rooms/${roomId}`),
            })
          }
        >
          {accept.isPending ? t("invite.joining") : t("invite.join")}
        </Button>
        <Button
          variant="secondary"
          className="h-9 flex-1"
          disabled={busy}
          onClick={() => decline.mutate(invitation.id)}
        >
          {t("invite.decline")}
        </Button>
      </div>
    </div>
  );
}
