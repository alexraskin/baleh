import { AwsClient } from "aws4fetch";

import { mediaProblem, type MediaPurpose, type UploadTarget } from "../shared/media.ts";
import { HttpError } from "./http.ts";

/*
 * R2 media: upload authorization, verification and authenticated serving.
 *
 * Uploads never pass through the Worker in production. The Worker signs a
 * short-lived R2 URL for one object key, content type and size; the browser
 * PUTs straight to R2; then the API checks the object before recording it.
 * The bucket stays private: everything is read back through member-checked
 * routes.
 *
 * Object keys:
 *   avatars/{userId}/{imageId}
 *   rooms/{roomId}/avatar/{version}
 *   attachments/{roomId}/{messageId}/{attachmentId}
 */

export const MEDIA_BUCKET = "baleh-media";
const UPLOAD_TTL_SECONDS = 5 * 60;

/** S3 API credentials for presigning, set as secrets. Absent in dev and tests. */
type MediaEnv = Env & {
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
};

/** What an upload token authorizes. Everything here was decided by the server. */
export interface UploadClaim {
  purpose: MediaPurpose;
  key: string;
  userId: string;
  contentType: string;
  size: number;
  /** Epoch milliseconds. */
  expiresAt: number;
  roomId?: string;
  messageId?: string;
  /** The attachment id, avatar image id or room avatar version. */
  objectId: string;
}

// Tokens ---------------------------------------------------------------------

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64url(text: string) {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function hmacKey(env: Env) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(`media-upload:${env.BETTER_AUTH_SECRET}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signClaim(env: Env, claim: UploadClaim) {
  const payload = base64url(encoder.encode(JSON.stringify(claim)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(env), encoder.encode(payload));
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

/** The claim inside a token, if it's ours, recent and (when given) for this purpose. */
export async function readClaim(env: Env, token: string, purpose?: MediaPurpose) {
  const [payload = "", signature = ""] = token.split(".");
  let claim: UploadClaim;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(env),
      fromBase64url(signature),
      encoder.encode(payload),
    );
    if (!valid) throw new Error("Bad signature");
    claim = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as UploadClaim;
  } catch {
    throw new HttpError(400, "Invalid upload");
  }
  if (purpose && claim.purpose !== purpose) throw new HttpError(400, "Invalid upload");
  if (claim.expiresAt < Date.now() - UPLOAD_TTL_SECONDS * 1000) {
    // Verification may come a little after the upload window closes, not long after.
    throw new HttpError(400, "Upload expired");
  }
  return claim;
}

// Uploads --------------------------------------------------------------------

/** Validates the file, then signs an upload for a server-chosen key. */
export async function createUpload(
  env: MediaEnv,
  fields: Omit<UploadClaim, "expiresAt">,
): Promise<UploadTarget> {
  const problem = mediaProblem(fields.purpose, fields.contentType, fields.size);
  if (problem) throw new HttpError(400, problem);

  const claim: UploadClaim = { ...fields, expiresAt: Date.now() + UPLOAD_TTL_SECONDS * 1000 };
  const token = await signClaim(env, claim);
  const headers = { "Content-Type": claim.contentType };
  const expiresAt = new Date(claim.expiresAt).toISOString();

  if (env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ACCOUNT_ID) {
    return { token, url: await presign(env, claim), headers, expiresAt };
  }
  // Without S3 credentials (dev, tests) the Worker stands in for R2, guarded by the token.
  if (env.ENVIRONMENT === "production") throw new HttpError(503, "Uploads aren't configured");
  return { token, url: `/api/uploads/${encodeURIComponent(token)}`, headers, expiresAt };
}

/** A presigned R2 PUT bound to the key, content type and size. */
export async function presign(env: MediaEnv, claim: UploadClaim) {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    service: "s3",
    region: "auto",
  });
  const url = new URL(
    `https://${env.R2_ACCOUNT_ID!}.r2.cloudflarestorage.com/${MEDIA_BUCKET}/${claim.key}`,
  );
  url.searchParams.set("X-Amz-Expires", String(UPLOAD_TTL_SECONDS));
  const signed = await client.sign(
    new Request(url, {
      method: "PUT",
      headers: { "Content-Type": claim.contentType, "Content-Length": String(claim.size) },
    }),
    { aws: { signQuery: true, allHeaders: true } },
  );
  return signed.url;
}

/** Dev and test stand-in for a presigned PUT. Production never routes uploads here. */
export async function localUpload(request: Request, env: MediaEnv, token: string) {
  if (env.ENVIRONMENT === "production") throw new HttpError(404, "Not found");
  const claim = await readClaim(env, token);
  if (claim.expiresAt < Date.now()) throw new HttpError(403, "Upload expired");
  if (request.headers.get("Content-Type") !== claim.contentType) {
    throw new HttpError(403, "Content type doesn't match the upload");
  }
  const body = await request.arrayBuffer();
  if (body.byteLength !== claim.size) throw new HttpError(403, "Size doesn't match the upload");
  await env.MEDIA.put(claim.key, body, { httpMetadata: { contentType: claim.contentType } });
  return new Response(null, { status: 200 });
}

// Verification ---------------------------------------------------------------

const signatures: Record<string, (bytes: Uint8Array) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v),
  "image/gif": (b) => ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a",
  "image/webp": (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
};

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/**
 * Checks the uploaded object is what was authorized: present, the signed size
 * and type, and really that kind of file. Anything else is deleted.
 */
export async function verifyUpload(env: Env, claim: UploadClaim) {
  const object = await env.MEDIA.get(claim.key, { range: { offset: 0, length: 16 } });
  if (!object) throw new HttpError(400, "Upload not found. Try again.");
  const head = new Uint8Array(await object.arrayBuffer());
  const valid =
    object.size === claim.size &&
    object.httpMetadata?.contentType === claim.contentType &&
    signatures[claim.contentType]?.(head) === true;
  if (!valid) {
    await env.MEDIA.delete(claim.key);
    throw new HttpError(400, "That file isn't a valid image.");
  }
}

// Serving and cleanup ---------------------------------------------------------

/** Streams a private object to an already-authorized caller. */
export async function serveObject(env: Env, key: string, cacheSeconds = 86_400) {
  const object = await env.MEDIA.get(key);
  if (!object) throw new HttpError(404, "Not found");
  const contentType = object.httpMetadata?.contentType ?? "";
  return new Response(object.body, {
    headers: {
      // Only types we accept are served as themselves; nothing here can run script.
      "Content-Type": signatures[contentType] ? contentType : "application/octet-stream",
      "Content-Length": String(object.size),
      "Content-Disposition": "inline",
      "Cache-Control": `private, max-age=${cacheSeconds}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      ETag: object.httpEtag,
    },
  });
}

export async function deleteObject(env: Env, key: string | null | undefined) {
  if (!key) return;
  try {
    await env.MEDIA.delete(key);
  } catch (error) {
    console.error("Media delete failed", key, error);
  }
}

/** Removes everything under a prefix, e.g. a deleted room's files. Best effort. */
export async function deletePrefix(env: Env, prefix: string) {
  try {
    let cursor: string | undefined;
    do {
      const page = await env.MEDIA.list({ prefix, cursor });
      if (page.objects.length > 0) await env.MEDIA.delete(page.objects.map((o) => o.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  } catch (error) {
    console.error("Media cleanup failed", prefix, error);
  }
}

/**
 * Upload tokens are dead 10 minutes after issue (readClaim), so an object this old that
 * nothing points at can never be claimed.
 */
const ORPHAN_AFTER_MS = 60 * 60 * 1000;

/**
 * Deletes uploads that were never used: an attachment whose message was never sent, or an
 * avatar never set (or since replaced). Runs from the cron trigger.
 */
// ponytail: lists the whole attachments/, avatars/ and rooms/ prefixes every run. Fine for thousands
// of objects; past that, record issued uploads in D1 and sweep that table instead.
export async function sweepOrphanedUploads(env: Env, now = Date.now()) {
  const cutoff = now - ORPHAN_AFTER_MS;
  let deleted = 0;
  for (const prefix of ["attachments/", "avatars/", "rooms/"]) {
    let cursor: string | undefined;
    do {
      const page = await env.MEDIA.list({ prefix, cursor });
      cursor = page.truncated ? page.cursor : undefined;
      const old = page.objects
        .filter((o) => o.uploaded.getTime() < cutoff)
        .map((o) => o.key)
        // Legacy rooms/{roomId}/avatar keys predate versioning; their room owns them.
        .filter((key) => !/^rooms\/[^/]+\/avatar$/.test(key));
      if (old.length === 0) continue;
      const { results } = await env.DB.prepare(
        `select value as "key" from json_each(?1)
         where value in (select "objectKey" from "attachment")
            or value in (select "avatarKey" from "user" where "avatarKey" is not null)
            or value in (select 'rooms/' || "id" || '/avatar/' || "avatarVersion" from "room"
                         where "avatarVersion" is not null)`,
      )
        .bind(JSON.stringify(old))
        .all<{ key: string }>();
      const used = new Set(results.map((row) => row.key));
      const orphans = old.filter((key) => !used.has(key));
      if (orphans.length > 0) {
        await env.MEDIA.delete(orphans);
        deleted += orphans.length;
      }
    } while (cursor);
  }
  return deleted;
}

/** Every R2 object a room owns: its avatar and its attachments. */
export async function deleteRoomMedia(env: Env, roomId: string) {
  await deletePrefix(env, `rooms/${roomId}/`);
  await deletePrefix(env, `attachments/${roomId}/`);
}
