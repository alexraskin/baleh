import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Browser code, typed against the DOM; this project has Worker types, so load it untyped.
const browserPush = "../src/lib/push.ts";
const { isSafePath, pushSupport } = (await import(/* @vite-ignore */ browserPush)) as {
  isSafePath: (value: unknown) => boolean;
  pushSupport: () => "supported" | "unsupported" | "needs-install";
};

/*
 * public/sw.js and the browser-side support check, run against hand-made stand-ins
 * for the service worker and window globals. Nothing is shown or sent.
 */

type Listener = (event: any) => void;
const listeners = new Map<string, Listener>();

const shown: { title: string; options: Record<string, unknown> }[] = [];
const opened: string[] = [];
let windows: {
  url: string;
  focused: boolean;
  focus: () => Promise<void>;
  postMessage: (m: unknown) => void;
}[] = [];

beforeAll(async () => {
  // The worker's global stands in for the service worker's `self`.
  vi.spyOn(globalThis, "addEventListener").mockImplementation(
    ((type: string, listener: Listener) =>
      void listeners.set(type, listener)) as typeof addEventListener,
  );
  Object.assign(globalThis, {
    location: new URL("https://baleh.dev/sw.js"),
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) =>
        void shown.push({ title, options }),
    },
    clients: {
      matchAll: async () => windows,
      openWindow: async (url: string) => void opened.push(url),
      claim: async () => {},
    },
  });
  await import("../public/sw.js" as string);
  vi.restoreAllMocks();
});

afterEach(() => {
  shown.length = 0;
  opened.length = 0;
  windows = [];
  vi.unstubAllGlobals();
});

/** Fires a service worker event and waits for its waitUntil work. */
async function fire(type: string, event: Record<string, unknown>) {
  let work: Promise<unknown> = Promise.resolve();
  listeners.get(type)!({ ...event, waitUntil: (promise: Promise<unknown>) => (work = promise) });
  await work;
}

function fakeWindow(url: string, focused = false) {
  const tab = {
    url,
    focused,
    messages: [] as unknown[],
    focus: vi.fn(async () => {}),
    postMessage: (message: unknown) => void tab.messages.push(message),
  };
  windows.push(tab);
  return tab;
}

const click = (url: unknown) => {
  const notification = { data: { url }, close: vi.fn() };
  return { notification, done: fire("notificationclick", { notification }) };
};

describe("service worker", () => {
  it("shows the pushed title and body, tagged per room", async () => {
    const payload = {
      title: "Maman",
      body: "New message in Family",
      url: "/rooms/r1",
      tag: "room:r1",
    };
    await fire("push", { data: { json: () => payload } });
    expect(shown).toEqual([
      {
        title: "Maman",
        options: expect.objectContaining({
          body: "New message in Family",
          tag: "room:r1",
          renotify: true,
          data: { url: "/rooms/r1" },
        }),
      },
    ]);
  });

  it("still shows something for an unreadable payload", async () => {
    await fire("push", {
      data: {
        json: () => {
          throw new SyntaxError("bad");
        },
      },
    });
    expect(shown[0]).toMatchObject({ title: "Baleh", options: { data: { url: "/rooms" } } });
  });

  it("focuses an open tab and navigates it to the room, closing the notification", async () => {
    const other = fakeWindow("https://baleh.dev/settings");
    const { notification, done } = click("/rooms/r1");
    await done;
    expect(notification.close).toHaveBeenCalled();
    expect(other.focus).toHaveBeenCalled();
    expect(other.messages).toEqual([{ type: "navigate", url: "/rooms/r1" }]);
    expect(opened).toEqual([]);
  });

  it("prefers the tab already showing that room", async () => {
    const focused = fakeWindow("https://baleh.dev/rooms", true);
    const room = fakeWindow("https://baleh.dev/rooms/r1");
    await click("/rooms/r1").done;
    expect(room.focus).toHaveBeenCalled();
    expect(focused.focus).not.toHaveBeenCalled();
  });

  it("opens a new window when Baleh isn't open", async () => {
    await click("/rooms/r1").done;
    expect(opened).toEqual(["/rooms/r1"]);
  });

  it("never leaves the site", async () => {
    await click("https://evil.example/phish").done;
    await click("//evil.example/x").done;
    await click(42).done;
    expect(opened).toEqual(["/rooms", "/rooms", "/rooms"]);
  });
});

describe("browser support", () => {
  function stubBrowser(
    userAgent: string,
    features: { push: boolean; standalone?: boolean; touch?: number },
  ) {
    vi.stubGlobal("navigator", {
      userAgent,
      maxTouchPoints: features.touch ?? 0,
      ...(features.push && { serviceWorker: {} }),
    });
    vi.stubGlobal("window", features.push ? { PushManager: {}, Notification: {} } : {});
    vi.stubGlobal("matchMedia", () => ({ matches: features.standalone ?? false }));
  }

  it("is supported where the Push API is", () => {
    stubBrowser("Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0", { push: true });
    expect(pushSupport()).toBe("supported");
  });

  it("asks iPhone and iPad users to add the app to their Home Screen", () => {
    stubBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", { push: false });
    expect(pushSupport()).toBe("needs-install");
    stubBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", { push: false, touch: 5 });
    expect(pushSupport()).toBe("needs-install");
  });

  it("reports other browsers without push as unsupported", () => {
    stubBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", { push: false });
    expect(pushSupport()).toBe("unsupported");
    stubBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)", {
      push: false,
      standalone: true,
    });
    expect(pushSupport()).toBe("unsupported");
  });

  it("only follows same-site paths from the service worker", () => {
    expect(isSafePath("/rooms/r1")).toBe(true);
    expect(isSafePath("//evil.example")).toBe(false);
    expect(isSafePath("https://evil.example")).toBe(false);
    expect(isSafePath(null)).toBe(false);
  });
});
