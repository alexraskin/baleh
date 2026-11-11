import type { RoomMember } from "@shared/rooms.ts";

import { Avatar } from "@/components/ui/avatar";
import { Dialog } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";

export interface MemberProfileDialogProps {
  member: RoomMember | null;
  online: boolean;
  onClose: () => void;
}

/** A room member's profile, opened by tapping their name in the chat. */
export function MemberProfileDialog({ member, online, onClose }: MemberProfileDialogProps) {
  const { t, format } = useI18n();
  return (
    <Dialog open={member !== null} onClose={onClose} title={member?.displayName ?? ""}>
      {member && (
        <div className="flex flex-col items-center gap-4 text-center">
          <Avatar name={member.displayName} src={member.avatarUrl ?? undefined} size="lg" />
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
            {member.role !== "member" && (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent-hover">
                {member.role === "owner" ? t("roomSettings.owner") : t("roomSettings.admin")}
              </span>
            )}
            {online && (
              <span className="inline-flex items-center gap-1 text-text-muted">
                <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
                {t("member.online")}
              </span>
            )}
          </div>
          <dl className="grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-start text-text-muted">{t("member.language")}</dt>
            <dd className="text-end text-text">{format.language(member.preferredLanguage)}</dd>
            <dt className="text-start text-text-muted">{t("member.joined")}</dt>
            <dd className="text-end text-text">
              <time dateTime={member.joinedAt}>{format.date(member.joinedAt)}</time>
            </dd>
          </dl>
        </div>
      )}
    </Dialog>
  );
}
