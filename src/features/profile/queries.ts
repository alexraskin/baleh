import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { LanguageCode } from "@shared/languages.ts";
import type { Profile, UpdateProfileInput } from "@shared/profile.ts";
import type { NotificationPreferences } from "@shared/push.ts";

import type { AvatarUpload } from "@/features/media/avatar-editor";
import { apiFetch } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { uploadFile } from "@/lib/upload";

export const profileQueryKey = ["profile"] as const;

export function useProfile() {
  return useQuery({
    queryKey: profileQueryKey,
    queryFn: () => apiFetch<Profile>("/me"),
  });
}

function useProfileMutation<Input>(mutationFn: (input: Input) => Promise<unknown>) {
  const queryClient = useQueryClient();
  const session = authClient.useSession();

  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileQueryKey });
      // Keep the Better Auth session payload (used by the shell) in step.
      await session.refetch();
    },
  });
}

export function useUpdateProfile() {
  return useProfileMutation((input: UpdateProfileInput) =>
    apiFetch<Profile>("/me", { method: "PATCH", json: input }),
  );
}

export function useUpdateLanguage() {
  return useProfileMutation((preferredLanguage: LanguageCode) =>
    apiFetch<{ preferredLanguage: LanguageCode }>("/me/language", {
      method: "PUT",
      json: { preferredLanguage },
    }),
  );
}

export function useSetAvatar() {
  return useProfileMutation(async ({ file, onProgress }: AvatarUpload) => {
    const token = await uploadFile("/me/avatar/uploads", "avatar", file, onProgress);
    return apiFetch("/me/avatar", { method: "PUT", json: { token } });
  });
}

export function useRemoveAvatar() {
  return useProfileMutation(() => apiFetch("/me/avatar", { method: "DELETE" }));
}

export function useAppConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: () =>
      apiFetch<{
        signUpEnabled: boolean;
        vapidPublicKey: string | null;
        turnstileSiteKey: string | null;
      }>("/config"),
    staleTime: Infinity,
  });
}

const notificationPreferencesKey = ["notification-preferences"] as const;

export function useNotificationPreferences() {
  return useQuery({
    queryKey: notificationPreferencesKey,
    queryFn: () => apiFetch<NotificationPreferences>("/me/notification-preferences"),
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (preferences: NotificationPreferences) =>
      apiFetch<NotificationPreferences>("/me/notification-preferences", {
        method: "PUT",
        json: preferences,
      }),
    onSuccess: (saved) => queryClient.setQueryData(notificationPreferencesKey, saved),
  });
}
