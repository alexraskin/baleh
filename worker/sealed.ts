/*
 * Message text at rest: AES-256-GCM with a key the Workers hold (MESSAGE_KEY), so a D1
 * export or backup doesn't contain conversations. This is not end-to-end encryption; the
 * Workers still see plaintext (they have to, to translate it).
 *
 * Format: "v1:" + base64(iv || ciphertext). The associated data names the row the text
 * belongs to, so a ciphertext copied into another row fails to open.
 */

const VERSION = "v1:";
const IV_BYTES = 12;

/** The Secrets Store binding (shared by both Workers). */
export type MessageKey = SecretsStoreSecret | undefined;

// One Secrets Store read and key import per binding per isolate, not per message.
const keys = new WeakMap<SecretsStoreSecret, Promise<CryptoKey>>();

async function importKey(binding: SecretsStoreSecret) {
  const secret = await binding.get();
  // Fail closed: without a key nothing is written, rather than written in the clear.
  if (!secret) throw new Error("MESSAGE_KEY is not set");
  const raw = Uint8Array.from(atob(secret), (char) => char.charCodeAt(0));
  if (raw.length !== 32) throw new Error("MESSAGE_KEY must be 32 bytes, base64");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function messageKey(binding: MessageKey) {
  if (!binding) return Promise.reject(new Error("MESSAGE_KEY is not set"));
  let key = keys.get(binding);
  if (!key) {
    key = importKey(binding);
    // Don't cache a failure; the next call reads the secret again.
    key.catch(() => keys.delete(binding));
    keys.set(binding, key);
  }
  return key;
}

/** Associated data for a message's original text. */
export const messageAad = (messageId: string) => `message:${messageId}`;
/** Associated data for one translation of a message. */
export const translationAad = (messageId: string, language: string) =>
  `translation:${messageId}:${language}`;

export async function seal(secret: MessageKey, text: string, aad: string) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    await messageKey(secret),
    new TextEncoder().encode(text),
  );
  const bytes = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  bytes.set(iv);
  bytes.set(new Uint8Array(ciphertext), IV_BYTES);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return VERSION + btoa(binary);
}

export async function unseal(secret: MessageKey, sealed: string, aad: string) {
  if (!sealed.startsWith(VERSION)) throw new Error("Unknown sealed text version");
  const bytes = Uint8Array.from(atob(sealed.slice(VERSION.length)), (char) => char.charCodeAt(0));
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: bytes.subarray(0, IV_BYTES),
      additionalData: new TextEncoder().encode(aad),
    },
    await messageKey(secret),
    bytes.subarray(IV_BYTES),
  );
  return new TextDecoder().decode(plaintext);
}

/** Rows written before encryption keep plaintext until the sweeper seals them. */
export function readText(
  secret: MessageKey,
  sealed: string | null,
  plain: string | null,
  aad: string,
) {
  return sealed ? unseal(secret, sealed, aad) : Promise.resolve(plain);
}
