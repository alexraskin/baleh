/**
 * Date, number and language-name formatting for one locale, built on Intl.
 * Persian gets Persian digits and the Solar Hijri calendar for free.
 */
export type Formatters = ReturnType<typeof build>;

const cache = new Map<string, Formatters>();

/**
 * Right-to-left locales spell units out ("۵ مگابایت"): an abbreviation like "MB"
 * is a left-to-right run that reads backwards next to the number.
 */
export function formattersFor(locale: string, dir: "ltr" | "rtl"): Formatters {
  const key = `${locale} ${dir}`;
  let formatters = cache.get(key);
  if (!formatters) cache.set(key, (formatters = build(locale, dir === "rtl" ? "long" : "short")));
  return formatters;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole calendar days from `date` to `now`: 0 today, 1 yesterday. */
function daysAgo(date: Date, now: Date) {
  return Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
}

function build(locale: string, unitDisplay: "long" | "short") {
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
  const shortDay = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  const shortDayTime = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const full = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" });
  const weekday = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const longDay = new Intl.DateTimeFormat(locale, { dateStyle: "long" });
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: "percent" });
  const kilobytes = new Intl.NumberFormat(locale, { style: "unit", unit: "kilobyte", unitDisplay });
  const megabytes = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "megabyte",
    unitDisplay,
    maximumFractionDigits: 1,
  });
  const languageNames = new Intl.DisplayNames([locale], { type: "language" });
  const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);

  return {
    number: (value: number) => number.format(value),
    percent: (fraction: number) => percent.format(fraction),
    bytes: (bytes: number) =>
      bytes < 1024 * 1024
        ? kilobytes.format(Math.max(1, Math.round(bytes / 1024)))
        : megabytes.format(bytes / (1024 * 1024)),
    language: (code: string) => capitalize(languageNames.of(code) ?? code),
    /** "November 9, 2026". */
    date: (iso: string) => longDay.format(new Date(iso)),
    /** "9:41 PM". */
    time: (iso: string) => time.format(new Date(iso)),
    /** Everything, for tooltips: "Sunday, November 9, 2026 at 9:41 PM". */
    full: (iso: string) => full.format(new Date(iso)),
    /** Time today, short date otherwise, for list previews. */
    relativeDay: (iso: string, now = new Date()) => {
      const date = new Date(iso);
      return daysAgo(date, now) === 0 ? time.format(date) : shortDay.format(date);
    },
    /** "9:41 PM" today, "Nov 6, 9:41 PM" otherwise. */
    dayTime: (iso: string, now = new Date()) => {
      const date = new Date(iso);
      return daysAgo(date, now) === 0 ? time.format(date) : shortDayTime.format(date);
    },
    /** Divider label in a conversation: "Today", "Yesterday", "Monday, November 3". */
    dayHeading: (iso: string, now = new Date()) => {
      const date = new Date(iso);
      const days = daysAgo(date, now);
      if (days === 0 || days === 1) return capitalize(relative.format(-days, "day"));
      return days < 300 ? weekday.format(date) : longDay.format(date);
    },
    /** Calendar-day key for grouping messages. */
    dayKey: (iso: string) => startOfDay(new Date(iso)),
  };
}
