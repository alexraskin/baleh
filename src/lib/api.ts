export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface ApiRequestInit extends Omit<RequestInit, "body"> {
  /** Serialised as JSON. */
  json?: unknown;
}

/** Latest D1 bookmark from the API, echoed back so reads see this tab's own writes. */
let bookmark: string | null = null;

/**
 * Call before refetching after someone else's write (a socket event): the bookmark only
 * covers this tab's writes, so a replica that satisfies it may still lack theirs. With
 * none, the next request reads from the primary and returns a fresh bookmark.
 */
export function forgetBookmark() {
  bookmark = null;
}

/** JSON fetch wrapper for same-origin `/api` calls. Session cookies ride along automatically. */
export async function apiFetch<T>(path: string, { json, headers, ...init }: ApiRequestInit = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...init,
    headers: {
      Accept: "application/json",
      ...(json !== undefined && { "Content-Type": "application/json" }),
      ...(bookmark && { "x-d1-bookmark": bookmark }),
      ...headers,
    },
    body: json === undefined ? undefined : JSON.stringify(json),
  });

  bookmark = response.headers.get("x-d1-bookmark") ?? bookmark;
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new ApiError(response.status, body?.error ?? response.statusText);
  }
  return body as T;
}
