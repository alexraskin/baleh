import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import type {
  CreatedInvitation,
  CreateRoomInput,
  ReceivedInvitation,
  RoomDetail,
  RoomSummary,
  SentInvitation,
  UpdateRoomInput,
} from "@shared/rooms.ts";

import { messagesKey } from "@/features/chat/queries";
import type { AvatarUpload } from "@/features/media/avatar-editor";
import { apiFetch } from "@/lib/api";
import { uploadFile } from "@/lib/upload";

export const roomKeys = {
  all: ["rooms"] as const,
  detail: (roomId: string) => ["rooms", roomId] as const,
  invitations: (roomId: string) => ["rooms", roomId, "invitations"] as const,
};

export const myInvitationsKey = ["invitations"] as const;

export function useRooms() {
  return useQuery({
    queryKey: roomKeys.all,
    queryFn: async () => (await apiFetch<{ rooms: RoomSummary[] }>("/rooms")).rooms,
  });
}

export function useRoom(roomId: string) {
  return useQuery({
    queryKey: roomKeys.detail(roomId),
    queryFn: () => apiFetch<RoomDetail>(`/rooms/${encodeURIComponent(roomId)}`),
  });
}

export function useCreateRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRoomInput) =>
      apiFetch<RoomDetail>("/rooms", { method: "POST", json: input }),
    onSuccess: (room) => {
      queryClient.setQueryData(roomKeys.detail(room.id), room);
      return queryClient.invalidateQueries({ queryKey: roomKeys.all, exact: true });
    },
  });
}

export function useUpdateRoom(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateRoomInput) =>
      apiFetch<RoomDetail>(`/rooms/${encodeURIComponent(roomId)}`, {
        method: "PATCH",
        json: input,
      }),
    onSuccess: (room) => {
      queryClient.setQueryData(roomKeys.detail(roomId), room);
      return queryClient.invalidateQueries({ queryKey: roomKeys.all, exact: true });
    },
  });
}

function useRoomAvatarMutation<Input>(request: (input: Input) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: roomKeys.all }),
  });
}

export function useSetRoomAvatar(roomId: string) {
  const path = `/rooms/${encodeURIComponent(roomId)}/avatar`;
  return useRoomAvatarMutation(async ({ file, onProgress }: AvatarUpload) => {
    const token = await uploadFile(`${path}/uploads`, "roomAvatar", file, onProgress);
    return apiFetch(path, { method: "PUT", json: { token } });
  });
}

export function useRemoveRoomAvatar(roomId: string) {
  return useRoomAvatarMutation(() =>
    apiFetch(`/rooms/${encodeURIComponent(roomId)}/avatar`, { method: "DELETE" }),
  );
}

/**
 * Leaving and deleting both end with the room gone from this user's view.
 * Navigates away before dropping the cached room so the page doesn't refetch it.
 */
function useRoomExit(roomId: string, request: () => Promise<unknown>) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: request,
    onSuccess: async () => {
      await navigate("/rooms", { replace: true });
      queryClient.removeQueries({ queryKey: roomKeys.detail(roomId) });
      queryClient.removeQueries({ queryKey: messagesKey(roomId) });
      await queryClient.invalidateQueries({ queryKey: roomKeys.all, exact: true });
    },
  });
}

export function useLeaveRoom(roomId: string) {
  return useRoomExit(roomId, () =>
    apiFetch(`/rooms/${encodeURIComponent(roomId)}/leave`, { method: "POST" }),
  );
}

export function useDeleteRoom(roomId: string) {
  return useRoomExit(roomId, () =>
    apiFetch(`/rooms/${encodeURIComponent(roomId)}`, { method: "DELETE" }),
  );
}

export function useRemoveMember(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}`, {
        method: "DELETE",
      }),
    // The list shows member counts too; this prefix covers it and the detail.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: roomKeys.all }),
  });
}

export function useSetMemberRole(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "admin" | "member" }) =>
      apiFetch(`/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        json: { role },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: roomKeys.detail(roomId) }),
  });
}

export function useRoomInvitations(roomId: string, enabled: boolean) {
  return useQuery({
    queryKey: roomKeys.invitations(roomId),
    queryFn: async () =>
      (
        await apiFetch<{ invitations: SentInvitation[] }>(
          `/rooms/${encodeURIComponent(roomId)}/invitations`,
        )
      ).invitations,
    enabled,
  });
}

export function useCreateInvitation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      apiFetch<CreatedInvitation>(`/rooms/${encodeURIComponent(roomId)}/invitations`, {
        method: "POST",
        json: { email },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: roomKeys.invitations(roomId) }),
  });
}

export function useRevokeInvitation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) =>
      apiFetch(
        `/rooms/${encodeURIComponent(roomId)}/invitations/${encodeURIComponent(invitationId)}`,
        { method: "DELETE" },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: roomKeys.invitations(roomId) }),
  });
}

export function useMyInvitations() {
  return useQuery({
    queryKey: myInvitationsKey,
    queryFn: async () =>
      (await apiFetch<{ invitations: ReceivedInvitation[] }>("/invitations")).invitations,
  });
}

function useInvitationResponse<Input, Output>(mutationFn: (input: Input) => Promise<Output>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: myInvitationsKey }),
        queryClient.invalidateQueries({ queryKey: roomKeys.all, exact: true }),
      ]),
  });
}

export function useAcceptInvitation() {
  return useInvitationResponse((invitationId: string) =>
    apiFetch<{ roomId: string }>(`/invitations/${encodeURIComponent(invitationId)}/accept`, {
      method: "POST",
    }),
  );
}

export function useDeclineInvitation() {
  return useInvitationResponse((invitationId: string) =>
    apiFetch(`/invitations/${encodeURIComponent(invitationId)}/decline`, { method: "POST" }),
  );
}

export function useInvitePreview(token: string) {
  return useQuery({
    queryKey: ["invite", token],
    queryFn: () =>
      apiFetch<{ invitation: ReceivedInvitation; alreadyMember: boolean }>("/invite/preview", {
        method: "POST",
        json: { token },
      }),
  });
}

export function useAcceptInviteToken(token: string) {
  return useInvitationResponse(() =>
    apiFetch<{ roomId: string }>("/invite/accept", { method: "POST", json: { token } }),
  );
}
