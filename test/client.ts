import { env as baseEnv } from "cloudflare:workers";

import type { ServerEvent } from "../shared/messages.ts";
import type { AccountEmailJob, AccountEmailKind } from "../worker/email.ts";
import type { PushJob } from "../worker/push.ts";
import worker from "../worker/index.ts";

export const ORIGIN = "http://localhost:5173";

let counter = 0;

/** A unique email per call; the database is shared across tests in a file. */
export function uniqueEmail(label = "user"): string {
  counter += 1;
  return `${label}-${Date.now()}-${counter}@example.com`;
}

/**
 * Every account email job the Worker queued, from any client. The real queue is
 * replaced in tests, so nothing is ever sent.
 */
export const queuedEmails: AccountEmailJob[] = [];

const fakeEmailQueue = {
  send: async (job: AccountEmailJob) => void queuedEmails.push(job),
} as unknown as Env["ACCOUNT_EMAILS"];

/** Every push job the Worker queued. Like email, the real queue is replaced in tests. */
export const queuedPushes: PushJob[] = [];

const fakePushQueue = {
  send: async (job: PushJob) => void queuedPushes.push(job),
  sendBatch: async (jobs: { body: PushJob }[]) =>
    void queuedPushes.push(...jobs.map((job) => job.body)),
} as unknown as Env["PUSH_NOTIFICATIONS"];

/** Waits for the newest queued email of a kind to an address (they're queued after the response). */
export async function emailTo(to: string, kind: AccountEmailKind, after = 0) {
  for (let i = 0; i < 100; i++) {
    const job = queuedEmails.slice(after).findLast((j) => j.to === to && j.kind === kind);
    if (job) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`No ${kind} email to ${to}`);
}

/** Path and query of a link, to replay it against the Worker. */
export function pathOf(url: string): string {
  const { pathname, search } = new URL(url);
  return pathname + search;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** The one password the fake Pwned Passwords API (apply-migrations.ts) reports as breached. */
export const BREACHED_PASSWORD = "breached-password";

/**
 * Minimal browser stand-in: sends requests straight to the Worker's fetch
 * handler and keeps the cookies it sets, like a cookie jar.
 */
export class TestClient {
  private readonly cookies = new Map<string, string>();
  readonly env: Env;

  constructor(envOverrides: Partial<Env> = {}) {
    // A distinct env object also gets its own Better Auth instance.
    this.env = {
      ...baseEnv,
      ACCOUNT_EMAILS: fakeEmailQueue,
      PUSH_NOTIFICATIONS: fakePushQueue,
      ...envOverrides,
    };
  }

  get cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  /** Drops the session cookie cache, as if its maxAge passed, so the next request checks D1. */
  expireSessionCache(): void {
    for (const name of this.cookies.keys())
      if (name.endsWith("session_data")) this.cookies.delete(name);
  }

  setCookieHeader(header: string): void {
    this.cookies.clear();
    for (const pair of header.split(/;\s*/).filter(Boolean)) {
      const [name, ...rest] = pair.split("=");
      if (name) this.cookies.set(name, rest.join("="));
    }
  }

  async request(path: string, { method = "GET", body, headers = {} }: RequestOptions = {}) {
    const init: RequestInit = {
      method,
      headers: {
        Origin: ORIGIN,
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(this.cookies.size > 0 && { Cookie: this.cookieHeader }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    const response = await worker.fetch(
      new Request(`${ORIGIN}${path}`, init) as Request<unknown, IncomingRequestCfProperties>,
      this.env,
    );

    for (const cookie of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = cookie.split(";");
      const [name = "", ...rest] = pair.split("=");
      const value = rest.join("=");
      const expired = attributes.some((attribute) => /max-age=0/i.test(attribute.trim()));
      if (expired || value === "") this.cookies.delete(name.trim());
      else this.cookies.set(name.trim(), value);
    }

    const text = await response.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      // Non-JSON bodies are returned as text.
    }
    return {
      status: response.status,
      headers: response.headers,
      data: data as Record<string, unknown> & any,
    };
  }

  /** Opens the room's WebSocket the way a browser would: Upgrade header, cookies and Origin. */
  connect(roomId: string, headers: Record<string, string> = {}) {
    return this.openSocket(`/api/rooms/${roomId}/ws`, headers);
  }

  /** Opens the user's own socket, the one every page keeps open. */
  connectUser(headers: Record<string, string> = {}) {
    return this.openSocket("/api/ws", headers);
  }

  private async openSocket(path: string, headers: Record<string, string>) {
    const response = await worker.fetch(
      new Request(`${ORIGIN}${path}`, {
        headers: {
          Upgrade: "websocket",
          Origin: ORIGIN,
          ...(this.cookies.size > 0 && { Cookie: this.cookieHeader }),
          ...headers,
        },
      }) as Request<unknown, IncomingRequestCfProperties>,
      this.env,
    );
    return {
      status: response.status,
      socket: response.webSocket && new SocketProbe(response.webSocket),
    };
  }

  sendMessage(roomId: string, text: string, clientId: string = crypto.randomUUID()) {
    return this.request(`/api/rooms/${roomId}/messages`, {
      method: "POST",
      body: { text, clientId },
    });
  }

  signUp(overrides: Record<string, unknown> = {}) {
    const email = (overrides.email as string | undefined) ?? uniqueEmail();
    return this.request("/api/auth/sign-up/email", {
      method: "POST",
      body: {
        name: "Test Person",
        displayName: "Test Person",
        email,
        password: "correct-horse-battery",
        ...overrides,
      },
    });
  }

  /** Signs up, then opens the emailed verification link, which signs the client in. */
  async register(overrides: Record<string, unknown> = {}) {
    const email = ((overrides.email as string | undefined) ?? uniqueEmail()).toLowerCase();
    const signUp = await this.signUp({ ...overrides, email });
    if (signUp.status !== 200) return signUp;
    const verify = await this.request(pathOf((await emailTo(email, "verify-email")).url));
    if (verify.status !== 302) throw new Error(`Verification failed: ${verify.status}`);
    return signUp;
  }

  signIn(email: string, password = "correct-horse-battery") {
    return this.request("/api/auth/sign-in/email", {
      method: "POST",
      body: { email, password },
    });
  }

  signOut() {
    return this.request("/api/auth/sign-out", { method: "POST", body: {} });
  }
}

/** Registers a fresh user and returns their signed-in client and identity. */
export async function signedInUser(displayName = "Test Person", envOverrides: Partial<Env> = {}) {
  const client = new TestClient(envOverrides);
  const email = uniqueEmail(displayName.toLowerCase().replaceAll(/\W+/g, "-"));
  const signUp = await client.register({ email, name: displayName, displayName });
  if (signUp.status !== 200) throw new Error(`Sign-up failed: ${JSON.stringify(signUp.data)}`);
  const id = (await client.request("/api/me")).data.id as string;
  return { client, email, id };
}

/** Test side of a WebSocket: records server events and waits for specific ones. */
export class SocketProbe {
  readonly events: ServerEvent[] = [];
  closeCode: number | null = null;
  private listeners = new Set<() => void>();

  readonly ws: WebSocket;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.accept();
    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string" && event.data !== "pong") {
        this.events.push(JSON.parse(event.data) as ServerEvent);
      }
      this.notify();
    });
    ws.addEventListener("close", (event) => {
      this.closeCode = event.code;
      this.notify();
    });
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  /** Resolves when `check` returns a value, rejecting after `timeout` ms. */
  private waitFor<T>(check: () => T | undefined, timeout = 2000): Promise<T> {
    return new Promise((resolve, reject) => {
      const attempt = () => {
        const value = check();
        if (value === undefined) return false;
        this.listeners.delete(attempt);
        clearTimeout(timer);
        resolve(value);
        return true;
      };
      const timer = setTimeout(() => {
        this.listeners.delete(attempt);
        reject(new Error(`Timed out; events so far: ${JSON.stringify(this.events)}`));
      }, timeout);
      if (!attempt()) this.listeners.add(attempt);
    });
  }

  /** The first event of this type after `from` (an index into `events`). */
  next<Type extends ServerEvent["type"]>(type: Type, from = 0) {
    return this.waitFor(
      () =>
        this.events.slice(from).find((event) => event.type === type) as
          | Extract<ServerEvent, { type: Type }>
          | undefined,
    );
  }

  /** The first message event whose text matches. */
  messageWithText(text: string) {
    return this.waitFor(() =>
      this.events.find(
        (event): event is Extract<ServerEvent, { type: "message" }> =>
          event.type === "message" && event.message.text === text,
      ),
    );
  }

  closed() {
    return this.waitFor(() => this.closeCode ?? undefined);
  }

  send(data: unknown) {
    this.ws.send(typeof data === "string" ? data : JSON.stringify(data));
  }

  close() {
    this.ws.close(1000, "done");
  }
}
