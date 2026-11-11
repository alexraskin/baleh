/**
 * Prints a new VAPID key pair for browser push, as base64url (the format browsers and
 * worker/push.ts expect). Usage: node scripts/generate-vapid-keys.ts
 *
 * Changing keys invalidates every browser subscription; browsers re-subscribe on their
 * next visit (src/lib/push.ts).
 */
const toBase64Url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
const { d } = await crypto.subtle.exportKey("jwk", privateKey);

console.log(`VAPID_PUBLIC_KEY=${toBase64Url(raw)}`);
console.log(`VAPID_PRIVATE_KEY=${d}`);
