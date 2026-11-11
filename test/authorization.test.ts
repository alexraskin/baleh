import { describe, expect, it } from "vitest";

import { TestClient } from "./client.ts";

const privateEndpoints: [string, string, unknown?][] = [
  ["GET", "/api/me"],
  ["PATCH", "/api/me", { displayName: "Nope" }],
  ["PUT", "/api/me/language", { preferredLanguage: "fa" }],
];

describe("private endpoints", () => {
  it.each(privateEndpoints)("%s %s requires a session", async (method, path, body) => {
    const response = await new TestClient().request(path, { method, body });
    expect(response.status).toBe(401);
  });

  it.each(privateEndpoints)("%s %s rejects a forged session cookie", async (method, path, body) => {
    const client = new TestClient();
    client.setCookieHeader("better-auth.session_token=forged.value");
    const response = await client.request(path, { method, body });
    expect(response.status).toBe(401);
  });

  it("sends browser navigations to a page instead of JSON", async () => {
    const headers = { "Sec-Fetch-Mode": "navigate" };
    const signedOut = await new TestClient().request("/api/me", { headers });
    expect(signedOut.status).toBe(302);
    expect(signedOut.headers.get("Location")).toBe("http://localhost:5173/login");

    const missing = await new TestClient().request("/api/nope", { headers });
    expect(missing.headers.get("Location")).toBe("http://localhost:5173/not-found");
  });

  it("leaves public endpoints open", async () => {
    const client = new TestClient();
    expect((await client.request("/api/health")).status).toBe(200);
    expect((await client.request("/api/languages")).data).toEqual({
      languages: ["en", "fa", "ar", "de"],
      default: "en",
    });
  });
});

describe("profile updates", () => {
  it("updates only the signed-in user, ignoring ids from the client", async () => {
    const alice = new TestClient();
    await alice.register({ displayName: "Alice" });
    const bob = new TestClient();
    await bob.register({ displayName: "Bob" });
    const bobId = (await bob.request("/api/me")).data.id;

    const smuggled = await alice.request("/api/me", {
      method: "PATCH",
      body: { id: bobId, displayName: "Hacked" },
    });
    expect(smuggled.status).toBe(400);

    const own = await alice.request("/api/me", {
      method: "PATCH",
      body: { displayName: "Alice B." },
    });
    expect(own.status).toBe(200);
    expect(own.data.displayName).toBe("Alice B.");
    expect((await bob.request("/api/me")).data.displayName).toBe("Bob");
  });

  it("updates the display name", async () => {
    const client = new TestClient();
    await client.register();
    const response = await client.request("/api/me", {
      method: "PATCH",
      body: { displayName: "  Sara  " },
    });
    expect(response.status).toBe(200);
    expect(response.data).toMatchObject({ displayName: "Sara" });
  });

  it("updates the preferred language and reflects it in the session", async () => {
    const client = new TestClient();
    await client.register();
    const response = await client.request("/api/me/language", {
      method: "PUT",
      body: { preferredLanguage: "fa" },
    });
    expect(response.status).toBe(200);
    expect((await client.request("/api/me")).data.preferredLanguage).toBe("fa");
    const session = await client.request("/api/auth/get-session");
    expect(session.data.user.preferredLanguage).toBe("fa");
  });

  it.each([
    ["an unsupported language", "/api/me/language", "PUT", { preferredLanguage: "xx" }],
    // Profile pictures are uploaded (see media tests), never linked from elsewhere.
    ["an avatar link", "/api/me", "PATCH", { avatarUrl: "https://example.com/a.png" }],
    ["an empty display name", "/api/me", "PATCH", { displayName: "   " }],
    ["an empty update", "/api/me", "PATCH", {}],
  ])("rejects %s", async (_label, path, method, body) => {
    const client = new TestClient();
    await client.register();
    const response = await client.request(path, { method, body });
    expect(response.status).toBe(400);
  });

  it("requires a JSON body", async () => {
    const client = new TestClient();
    await client.register();
    const response = await client.request("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "text/plain" },
      body: "displayName=x",
    });
    expect(response.status).toBe(415);
  });

  it("rejects cross-origin writes", async () => {
    const client = new TestClient();
    await client.register();
    const response = await client.request("/api/me", {
      method: "PATCH",
      headers: { Origin: "https://evil.example" },
      body: { displayName: "Pwned" },
    });
    expect(response.status).toBe(403);
  });

  it("keeps Better Auth's own profile endpoint disabled", async () => {
    const client = new TestClient();
    await client.register();
    const response = await client.request("/api/auth/update-user", {
      method: "POST",
      body: { name: "x" },
    });
    expect(response.status).toBe(404);
  });
});

describe("trusted origins", () => {
  it("accepts other localhost ports only in development", async () => {
    const write = {
      method: "PATCH",
      headers: { Origin: "http://localhost:5199" },
      body: { displayName: "Dev" },
    };

    const dev = new TestClient({ ENVIRONMENT: "development" } as Partial<Env>);
    await dev.register();
    expect((await dev.request("/api/me", write)).status).toBe(200);

    const prod = new TestClient({ ENVIRONMENT: "production" } as Partial<Env>);
    await prod.register();
    expect((await prod.request("/api/me", write)).status).toBe(403);
  });
});
