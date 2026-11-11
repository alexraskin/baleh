import { adminSecretsStore, applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, vi } from "vitest";

import { BREACHED_PASSWORD } from "./client.ts";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// MESSAGE_KEY is a Secrets Store binding; seed it with a throwaway key.
{
  using admin = adminSecretsStore(env.MESSAGE_KEY);
  await admin.create("dGVzdC1tZXNzYWdlLWtleS0zMi1ieXRlcy1sb25nISE=");
}

const breachedSha1 = [
  ...new Uint8Array(
    await crypto.subtle.digest("SHA-1", new TextEncoder().encode(BREACHED_PASSWORD)),
  ),
]
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("")
  .toUpperCase();

// Stand in for api.pwnedpasswords.com so sign-ups never leave the test. Re-armed before
// each test because files call vi.restoreAllMocks().
beforeEach(() => {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const prefix = url.match(/^https:\/\/api\.pwnedpasswords\.com\/range\/(\w{5})$/)?.[1];
    if (!prefix) return realFetch(input, init);
    const body = breachedSha1.startsWith(prefix) ? `${breachedSha1.slice(5)}:42` : "";
    return new Response(body, { headers: { "content-type": "text/plain" } });
  });
});
