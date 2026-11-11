import { mediaProblem, type MediaPurpose, type UploadTarget } from "@shared/media.ts";

import { apiFetch } from "./api";

/**
 * Uploads a file straight to storage: asks the API (at `path`) for a signed
 * upload URL, then PUTs the file there, reporting progress from 0 to 1.
 * Resolves with the token the API needs to accept the upload.
 */
export async function uploadFile(
  path: string,
  purpose: MediaPurpose,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const problem = mediaProblem(purpose, file.type, file.size);
  if (problem) throw new Error(problem);
  const target = await apiFetch<UploadTarget>(path, {
    method: "POST",
    json: { contentType: file.type, size: file.size },
  });
  await put(target, file, onProgress);
  return target.token;
}

/** XHR rather than fetch, because fetch can't report upload progress. */
function put(target: UploadTarget, file: File, onProgress?: (fraction: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", target.url);
    for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    });
    xhr.addEventListener("load", () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error("Upload failed. Try again.")),
    );
    xhr.addEventListener("error", () => reject(new Error("Upload failed. Check your connection.")));
    xhr.send(file);
  });
}

/** Pixel size, to reserve space while the image loads. Empty if the browser can't decode it. */
export async function imageSize(file: File): Promise<{ width?: number; height?: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return {};
  }
}
