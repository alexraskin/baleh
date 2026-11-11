/*
 * Bidirectional text helpers for message rendering. Pure, so the Worker tests
 * can cover them; only the client uses them.
 */

export type Direction = "ltr" | "rtl";

/** Hebrew, Arabic and Persian letters, plus the Arabic presentation forms. */
const RTL_RANGES = "\\u0590-\\u08FF\\uFB1D-\\uFDFF\\uFE70-\\uFEFF";
const RTL_LETTER = new RegExp(`[${RTL_RANGES}]`);
const LTR_LETTER = new RegExp(`(?![${RTL_RANGES}])\\p{L}`, "u");

/**
 * Base direction for one paragraph of a message. Text in a single script goes
 * that script's way, so a Persian speaker's English line still reads left to
 * right with its punctuation in place. Mixed or letterless text (emoji, numbers)
 * follows the message's language, so "Zoom جلسه ساعت ۵" stays right to left.
 */
export function textDirection(text: string, languageDirection: Direction): Direction {
  const rtl = RTL_LETTER.test(text);
  const ltr = LTR_LETTER.test(text);
  if (rtl === ltr) return languageDirection;
  return rtl ? "rtl" : "ltr";
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"]+/gi;
/** Punctuation that usually ends the sentence around a link rather than the link. */
const TRAILING_PUNCTUATION = /[.,;:!?'")\]}،؛؟»]+$/;

export interface TextPart {
  text: string;
  /** Set when the part is an http(s) link. */
  href?: string;
}

/** Splits text into plain runs and http(s) links. */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, "");
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: url, href: url });
    last = match.index + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
