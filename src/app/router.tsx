import { createBrowserRouter } from "react-router";

import { AppShell } from "@/components/layout/app-shell";
import { AuthLayout } from "@/components/layout/auth-layout";
import { ForgotPasswordPage } from "@/features/auth/forgot-password-page";
import { LoginPage } from "@/features/auth/login-page";
import { RegisterPage } from "@/features/auth/register-page";
import { ResetPasswordPage } from "@/features/auth/reset-password-page";
import { VerifyEmailPage } from "@/features/auth/verify-email-page";
import { HomePage } from "@/features/misc/home-page";
import { NotFoundPage } from "@/features/misc/not-found-page";
import { PrivacyPage } from "@/features/misc/privacy-page";
import { SupportPage } from "@/features/misc/support-page";
import { RouteError } from "@/features/misc/route-error";
import { NotificationsPage } from "@/features/notifications/notifications-page";
import { AcceptInvitePage } from "@/features/rooms/accept-invite-page";
import { RoomPage } from "@/features/rooms/room-page";
import { RoomSettingsPage } from "@/features/rooms/room-settings-page";
import { RoomsPage } from "@/features/rooms/rooms-page";
import { SettingsPage } from "@/features/settings/settings-page";

import { RedirectIfAuthenticated, RequireAuth } from "./route-guards";

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      {
        element: <AuthLayout />,
        children: [
          {
            element: <RedirectIfAuthenticated />,
            children: [
              { index: true, element: <HomePage /> },
              { path: "login", element: <LoginPage /> },
              { path: "register", element: <RegisterPage /> },
            ],
          },
          // Reachable signed in or out: the link arrives by email.
          { path: "forgot-password", element: <ForgotPasswordPage /> },
          { path: "reset-password", element: <ResetPasswordPage /> },
          { path: "verify-email", element: <VerifyEmailPage /> },
          { path: "privacy", element: <PrivacyPage /> },
          { path: "support", element: <SupportPage /> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            // Invite links are opened from email or chat, so they get the focused auth layout.
            element: <AuthLayout />,
            children: [{ path: "invite/:token", element: <AcceptInvitePage /> }],
          },
          {
            element: <AppShell />,
            children: [
              { path: "rooms", element: <RoomsPage /> },
              { path: "rooms/:roomId", element: <RoomPage /> },
              { path: "rooms/:roomId/settings", element: <RoomSettingsPage /> },
              { path: "notifications", element: <NotificationsPage /> },
              { path: "settings", element: <SettingsPage /> },
            ],
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
