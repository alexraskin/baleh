import { Link, useNavigate, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Spinner } from "@/components/ui/spinner";
import { AuthCard, authLinkClass } from "@/features/auth/auth-card";
import { ApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useI18n } from "@/lib/i18n";
import { disablePush } from "@/lib/push";
import { useDocumentTitle } from "@/lib/use-document-title";

import { useAcceptInviteToken, useInvitePreview } from "./queries";

export function AcceptInvitePage() {
  const { t, error } = useI18n();
  useDocumentTitle(t("invite.pageTitle"));
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const preview = useInvitePreview(token);
  const accept = useAcceptInviteToken(token);

  if (preview.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (preview.isError) {
    const status = preview.error instanceof ApiError ? preview.error.status : 0;
    if (status === 403) return <WrongAccount />;
    return (
      <AuthCard
        title={status === 410 ? t("invite.unusableTitle") : t("invite.notFoundTitle")}
        description={
          status === 410
            ? t("invite.unusableDescription", { reason: error(preview.error.message) })
            : t("invite.notFoundDescription")
        }
        footer={<BackToRooms />}
      />
    );
  }

  const { invitation, alreadyMember } = preview.data;
  const roomLink = `/rooms/${invitation.roomId}`;

  if (alreadyMember) {
    return (
      <AuthCard
        title={t("invite.alreadyTitle")}
        description={t("invite.alreadyDescription", { room: invitation.roomName })}
      >
        <Button size="lg" onClick={() => navigate(roomLink, { replace: true })}>
          {t("invite.openRoom")}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t("invite.joinTitle", { room: invitation.roomName })}
      description={t("invite.joinDescription", {
        name: invitation.inviterName ?? t("common.someone"),
      })}
      footer={<BackToRooms label={t("invite.notNow")} />}
    >
      <div className="flex flex-col gap-4">
        <FormMessage>{accept.isError ? accept.error.message : null}</FormMessage>
        <Button
          size="lg"
          disabled={accept.isPending}
          onClick={() =>
            accept.mutate(undefined, {
              onSuccess: ({ roomId }) => navigate(`/rooms/${roomId}`, { replace: true }),
            })
          }
        >
          {accept.isPending ? t("invite.joining") : t("invite.joinRoom")}
        </Button>
      </div>
    </AuthCard>
  );
}

function BackToRooms({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <Link to="/rooms" className={authLinkClass}>
      {label ?? t("invite.goToYourRooms")}
    </Link>
  );
}

function WrongAccount() {
  const { t } = useI18n();
  const { data: session } = authClient.useSession();

  async function switchAccount() {
    // This browser stops getting the account's notifications.
    await disablePush().catch(() => {});
    // RequireAuth clears the cache and redirects back here (via ?next) once signed out.
    await authClient.signOut();
  }

  return (
    <AuthCard
      title={t("invite.wrongAccountTitle")}
      description={t("invite.wrongAccountDescription", {
        email: session?.user.email ?? t("invite.anotherAccount"),
      })}
      footer={<BackToRooms />}
    >
      <Button size="lg" variant="secondary" onClick={switchAccount}>
        {t("invite.useDifferentAccount")}
      </Button>
    </AuthCard>
  );
}
