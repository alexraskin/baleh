-- At most one open invitation per room and email; re-inviting replaces it.
create unique index "invitation_pending_roomId_email_idx"
  on "invitation" ("roomId", "email")
  where "acceptedAt" is null;
