import { useEffect } from "react";
import { Outlet, useMatch } from "react-router";

import { useAppConfig } from "@/features/profile/queries";
import { useCurrentUser } from "@/features/profile/use-current-user";
import { useLiveUpdates } from "@/features/rooms/use-live-updates";
import { useI18n } from "@/lib/i18n";
import { syncPush } from "@/lib/push";

import { MobileTabBar } from "./mobile-tab-bar";
import { Sidebar } from "./sidebar";

export function AppShell() {
  const { t } = useI18n();
  const user = useCurrentUser();
  useLiveUpdates();
  const vapidPublicKey = useAppConfig().data?.vapidPublicKey;
  useEffect(() => {
    if (vapidPublicKey === undefined) return;
    syncPush(vapidPublicKey, user.id).catch((error: unknown) =>
      console.warn("Couldn't refresh push subscription", error),
    );
  }, [vapidPublicKey, user.id]);
  // An open conversation takes the whole mobile screen, so the tab bar steps aside.
  const inRoom = useMatch("/rooms/:roomId/*") !== null;

  return (
    <div className="flex h-dvh overflow-hidden">
      <a
        href="#main"
        className="sr-only z-30 rounded-xl bg-surface text-sm font-medium whitespace-nowrap text-text shadow-soft focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:px-4 focus:py-3"
      >
        {t("common.skipToContent")}
      </a>
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        <main
          id="main"
          tabIndex={-1}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto focus:outline-none"
        >
          <Outlet />
        </main>
        {!inRoom && <MobileTabBar />}
      </div>
    </div>
  );
}
