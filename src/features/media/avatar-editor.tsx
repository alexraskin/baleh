import { useRef, useState } from "react";

import { imageTypes, mediaProblem, mediaRules, type MediaPurpose } from "@shared/media.ts";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { useI18n } from "@/lib/i18n";

export interface AvatarUpload {
  file: File;
  onProgress: (fraction: number) => void;
}

export interface AvatarEditorProps {
  /** For initials, and the accessible names of the controls. */
  name: string;
  src: string | null;
  purpose: MediaPurpose;
  upload: (input: AvatarUpload) => Promise<unknown>;
  remove: () => Promise<unknown>;
}

/** Picture, upload/change/remove buttons, progress and errors. */
export function AvatarEditor({ name, src, purpose, upload, remove }: AvatarEditorProps) {
  const { t, format } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null || removing;

  async function pick(file: File | undefined) {
    if (!file) return;
    const problem = mediaProblem(purpose, file.type, file.size);
    setError(problem);
    if (problem) return;
    setProgress(0);
    try {
      await upload({ file, onProgress: setProgress });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("avatar.uploadFailed"));
    } finally {
      setProgress(null);
    }
  }

  async function onRemove() {
    setError(null);
    setRemoving(true);
    try {
      await remove();
    } catch {
      setError(t("avatar.removeFailed"));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={name} src={src ?? undefined} size="lg" />
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={imageTypes.join(",")}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              void pick(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {progress !== null
              ? t("common.uploading", { percent: format.percent(progress) })
              : src
                ? t("avatar.change")
                : t("avatar.upload")}
          </Button>
          {src && (
            <Button variant="ghost" disabled={busy} onClick={onRemove}>
              {removing ? t("common.removing") : t("common.remove")}
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-text-muted">
        {t("avatar.hint", { size: format.bytes(mediaRules[purpose].maxBytes) })}
      </p>
      <FormMessage>{error}</FormMessage>
    </div>
  );
}
