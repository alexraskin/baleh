import { describe, expect, it } from "vitest";

import { splitLinks, textDirection } from "../shared/text.ts";

describe("textDirection", () => {
  it("follows the script when there's only one", () => {
    expect(textDirection("Hello!", "rtl")).toBe("ltr");
    expect(textDirection("سلام!", "ltr")).toBe("rtl");
  });

  it("falls back to the message language for mixed or letterless text", () => {
    expect(textDirection("Zoom جلسه ساعت ۵", "rtl")).toBe("rtl");
    expect(textDirection("Meeting with علی at 5", "ltr")).toBe("ltr");
    expect(textDirection("👍 123", "rtl")).toBe("rtl");
    expect(textDirection("", "ltr")).toBe("ltr");
  });
});

describe("splitLinks", () => {
  it("finds links and leaves sentence punctuation outside them", () => {
    expect(splitLinks("این را ببین https://example.com/a?b=1، خوب است")).toEqual([
      { text: "این را ببین " },
      { text: "https://example.com/a?b=1", href: "https://example.com/a?b=1" },
      { text: "، خوب است" },
    ]);
    expect(splitLinks("(see http://x.dev).")).toEqual([
      { text: "(see " },
      { text: "http://x.dev", href: "http://x.dev" },
      { text: ")." },
    ]);
  });

  it("ignores other schemes", () => {
    expect(splitLinks("javascript:alert(1)")).toEqual([{ text: "javascript:alert(1)" }]);
  });
});
