/**
 * Seeds the local D1 database with demo users, rooms and messages. Safe to re-run:
 * it replaces the seed rows (fixed ids) and leaves everything else alone.
 *
 *   mise run db:seed:local      (after mise run db:migrate:local)
 *
 * Every seed user's password is "password123".
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hashPassword } from "better-auth/crypto";

const password = "password123";

const users = [
  { id: "seed-reinhardt", name: "Reinhardt", email: "reinhardt@example.com", language: "de" },
  { id: "seed-ana", name: "Ana", email: "ana@example.com", language: "ar" },
  { id: "seed-echo", name: "Echo", email: "echo@example.com", language: "fa" },
  { id: "seed-soldier", name: "Soldier: 76", email: "soldier76@example.com", language: "en" },
  { id: "seed-tracer", name: "Tracer", email: "tracer@example.com", language: "en" },
];

const rooms = [
  {
    id: "seed-room-general",
    name: "Overwatch",
    members: ["seed-tracer", "seed-reinhardt", "seed-ana", "seed-echo", "seed-soldier"],
  },
  { id: "seed-room-payload", name: "Payload duty", members: ["seed-reinhardt", "seed-ana"] },
];

// Original text plus hand-written translations into every other language in the room,
// so the demo works offline.
const messages: {
  room: string;
  from: string;
  text: string;
  translations: Record<string, string>;
}[] = [
  {
    room: "seed-room-general",
    from: "seed-tracer",
    text: "Cheers, love! The cavalry's here!",
    translations: {
      de: "Keine Sorge, Schatz! Die Kavallerie ist da!",
      ar: "لا تقلقوا يا أعزائي! الفرسان وصلوا!",
      fa: "نگران نباشید عزیزان! سواره‌نظام رسید!",
    },
  },
  {
    room: "seed-room-general",
    from: "seed-echo",
    text: "سلام به همه! من اکو هستم. دارم زبان‌های شما را یاد می‌گیرم.",
    translations: {
      en: "Hi everyone! I'm Echo. I'm learning your languages.",
      de: "Hallo zusammen! Ich bin Echo. Ich lerne eure Sprachen.",
      ar: "مرحبًا بالجميع! أنا إيكو. أنا أتعلم لغاتكم.",
    },
  },
  {
    room: "seed-room-general",
    from: "seed-reinhardt",
    text: "Willkommen, Echo! Ich bin Reinhardt, zu deinen Diensten!",
    translations: {
      en: "Welcome, Echo! I am Reinhardt, at your service!",
      ar: "أهلًا بك يا إيكو! أنا راينهارت، في خدمتك!",
      fa: "خوش آمدی اکو! من راینهارت هستم، در خدمت شما!",
    },
  },
  {
    room: "seed-room-general",
    from: "seed-ana",
    text: "أهلًا يا إيكو. هل أكلتم جميعًا؟",
    translations: {
      en: "Welcome, Echo. Have you all eaten?",
      de: "Willkommen, Echo. Habt ihr alle gegessen?",
      fa: "خوش آمدی اکو. همه‌تان غذا خورده‌اید؟",
    },
  },
  {
    room: "seed-room-general",
    from: "seed-soldier",
    text: "Briefing at 0800. Don't be late.",
    translations: {
      de: "Besprechung um 8 Uhr. Seid pünktlich.",
      ar: "الاجتماع في الثامنة صباحًا. لا تتأخروا.",
      fa: "جلسه ساعت هشت صبح. دیر نکنید.",
    },
  },
  {
    room: "seed-room-general",
    from: "seed-tracer",
    text: "Ugh, 0800? I'll be there in a blink.",
    translations: {
      de: "Ach, 8 Uhr? Ich bin im Nu da.",
      ar: "الثامنة؟ سأكون هناك في لمح البصر.",
      fa: "ساعت هشت؟ در یک چشم بر هم زدن می‌رسم.",
    },
  },
  {
    room: "seed-room-general",
    from: "seed-echo",
    text: "می‌توانم صبحانه بیاورم. نان بربری خوب است؟",
    translations: {
      en: "I can bring breakfast. Is barbari bread okay?",
      de: "Ich kann Frühstück mitbringen. Ist Barbari-Brot okay?",
      ar: "يمكنني إحضار الفطور. هل خبز البربري مناسب؟",
    },
  },
  {
    room: "seed-room-general",
    from: "seed-reinhardt",
    text: "Brot! Endlich jemand mit Verstand.",
    translations: {
      en: "Bread! Finally, someone with sense.",
      ar: "خبز! أخيرًا شخص عاقل.",
      fa: "نان! بالاخره یک نفر عاقل.",
    },
  },
  {
    room: "seed-room-general",
    from: "seed-ana",
    text: "سأحضر القهوة. وليس قهوة الجيش السيئة.",
    translations: {
      en: "I'll bring coffee. Not the bad army coffee.",
      de: "Ich bringe Kaffee mit. Nicht den schlechten Armeekaffee.",
      fa: "من قهوه می‌آورم. نه آن قهوه‌ی بد ارتشی.",
    },
  },
  {
    room: "seed-room-general",
    from: "seed-soldier",
    text: "Nothing wrong with army coffee.",
    translations: {
      de: "Armeekaffee ist völlig in Ordnung.",
      ar: "لا عيب في قهوة الجيش.",
      fa: "قهوه‌ی ارتشی هیچ ایرادی ندارد.",
    },
  },
  {
    room: "seed-room-general",
    from: "seed-tracer",
    text: "Everything is wrong with army coffee 😂",
    translations: {
      de: "An Armeekaffee ist alles falsch 😂",
      ar: "كل شيء في قهوة الجيش خطأ 😂",
      fa: "قهوه‌ی ارتشی سرتاپا ایراد است 😂",
    },
  },
  {
    room: "seed-room-general",
    from: "seed-echo",
    text: "تطبیق داده شد: قهوه‌ی آنا، نه قهوه‌ی ارتش.",
    translations: {
      en: "Adapted: Ana's coffee, not army coffee.",
      de: "Angepasst: Anas Kaffee, nicht Armeekaffee.",
      ar: "تم التكيّف: قهوة آنا، وليس قهوة الجيش.",
    },
  },
  {
    room: "seed-room-general",
    from: "seed-reinhardt",
    text: "Und nach der Besprechung trainieren wir! Wer ist dabei?",
    translations: {
      en: "And after the briefing, we train! Who's in?",
      ar: "وبعد الاجتماع نتدرب! من معي؟",
      fa: "و بعد از جلسه تمرین می‌کنیم! کی پایه است؟",
    },
  },
  {
    room: "seed-room-general",
    from: "seed-ana",
    text: "أنا معك. سأبقيك على قيد الحياة كالعادة.",
    translations: {
      en: "I'm in. I'll keep you alive, as usual.",
      de: "Ich bin dabei. Ich halte dich am Leben, wie immer.",
      fa: "من هستم. مثل همیشه زنده نگهت می‌دارم.",
    },
  },
  {
    room: "seed-room-general",
    from: "seed-soldier",
    text: "Count me in.",
    translations: { de: "Ich bin dabei.", ar: "أنا معكم.", fa: "من هم هستم." },
  },
  {
    room: "seed-room-general",
    from: "seed-echo",
    text: "من هم می‌آیم. می‌خواهم حرکت‌های همه را یاد بگیرم.",
    translations: {
      en: "I'm coming too. I want to learn everyone's moves.",
      de: "Ich komme auch. Ich will die Moves von allen lernen.",
      ar: "سآتي أيضًا. أريد أن أتعلم حركات الجميع.",
    },
  },
  {
    room: "seed-room-general",
    from: "seed-tracer",
    text: "See you all at 0800. Don't forget the barbari!",
    translations: {
      de: "Bis um 8! Vergesst das Barbari-Brot nicht!",
      ar: "أراكم في الثامنة. لا تنسوا خبز البربري!",
      fa: "ساعت هشت می‌بینمتان. نان بربری یادتان نرود!",
    },
  },
  {
    room: "seed-room-payload",
    from: "seed-reinhardt",
    text: "Ana, wir müssen die Fracht bewegen!",
    translations: { ar: "آنا، يجب أن نحرك الشحنة!" },
  },
  {
    room: "seed-room-payload",
    from: "seed-ana",
    text: "خلفك يا راينهارت. لا تقلق.",
    translations: { de: "Hinter dir, Reinhardt. Keine Sorge." },
  },
];

const q = (value: string | null) => (value === null ? "null" : `'${value.replaceAll("'", "''")}'`);
const language = Object.fromEntries(users.map((u) => [u.id, u.language]));
const start = Date.now() - messages.length * 60_000;
const at = (i: number) => new Date(start + i * 60_000).toISOString();
const now = new Date().toISOString();

const sql: string[] = [
  // Cascades remove members, messages, translations and receipts.
  `delete from "room" where "id" like 'seed-%';`,
  `delete from "user" where "id" like 'seed-%';`,
];

for (const u of users) {
  const hash = await hashPassword(password);
  sql.push(
    `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "displayName", "preferredLanguage")
     values (${q(u.id)}, ${q(u.name)}, ${q(u.email)}, 1, ${q(now)}, ${q(now)}, ${q(u.name)}, ${q(u.language)});`,
    `insert into "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
     values (${q(`${u.id}-account`)}, ${q(u.id)}, 'credential', ${q(u.id)}, ${q(hash)}, ${q(now)}, ${q(now)});`,
  );
}

for (const r of rooms) {
  sql.push(
    `insert into "room" ("id", "name", "createdBy", "createdAt", "updatedAt")
     values (${q(r.id)}, ${q(r.name)}, ${q(r.members[0]!)}, ${q(at(0))}, ${q(now)});`,
    ...r.members.map(
      (m, i) =>
        `insert into "roomMember" ("roomId", "userId", "role", "joinedAt")
         values (${q(r.id)}, ${q(m)}, ${q(i === 0 ? "owner" : "member")}, ${q(at(0))});`,
    ),
  );
}

messages.forEach((m, i) => {
  const id = `seed-msg-${i}`;
  sql.push(
    `insert into "message" ("id", "roomId", "senderId", "originalText", "originalLanguage", "createdAt", "updatedAt")
     values (${q(id)}, ${q(m.room)}, ${q(m.from)}, ${q(m.text)}, ${q(language[m.from]!)}, ${q(at(i))}, ${q(at(i))});`,
    ...Object.entries(m.translations).map(
      ([target, text]) =>
        `insert into "messageTranslation" ("id", "messageId", "targetLanguage", "status", "translatedText", "provider", "model", "createdAt", "updatedAt")
         values (${q(`${id}-${target}`)}, ${q(id)}, ${q(target)}, 'done', ${q(text)}, 'seed', 'seed', ${q(at(i))}, ${q(at(i))});`,
    ),
  );
});

const file = join(mkdtempSync(join(tmpdir(), "baleh-seed-")), "seed.sql");
writeFileSync(file, sql.join("\n"));
execFileSync("npx", ["wrangler", "d1", "execute", "baleh", "--local", "--file", file], {
  stdio: "inherit",
});

console.log(`\nSeeded. Sign in as ${users.map((u) => u.email).join(", ")} with "${password}".`);
