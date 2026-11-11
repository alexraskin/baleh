/**
 * Creates a password user directly in D1, bypassing SIGNUPS_ENABLED=false.
 *
 *   PASSWORD='...' node scripts/create-user.ts <email> <name> [en|fa|ar|de] [--remote]
 *
 * Password comes from env so it stays out of shell history / process list.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hashPassword } from "better-auth/crypto";

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const [email, name, language = "en"] = args.filter((a) => a !== "--remote");
const password = process.env.PASSWORD;

if (!email || !name || !password) {
  console.error(
    "usage: PASSWORD='...' node scripts/create-user.ts <email> <name> [en|fa|ar|de] [--remote]",
  );
  process.exit(1);
}
if (password.length < 8) {
  console.error("password must be at least 8 characters");
  process.exit(1);
}

const q = (v: string) => `'${v.replaceAll("'", "''")}'`;
const id = randomUUID();
const now = new Date().toISOString();
const hash = await hashPassword(password);

const sql = `
insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "displayName", "preferredLanguage")
values (${q(id)}, ${q(name)}, ${q(email.toLowerCase())}, 1, ${q(now)}, ${q(now)}, ${q(name)}, ${q(language)});
insert into "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
values (${q(randomUUID())}, ${q(id)}, 'credential', ${q(id)}, ${q(hash)}, ${q(now)}, ${q(now)});
`;

const dir = mkdtempSync(join(tmpdir(), "baleh-user-"));
const file = join(dir, "user.sql");
writeFileSync(file, sql);
try {
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "baleh", remote ? "--remote" : "--local", "--file", file],
    { stdio: "inherit" },
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\nCreated ${email} (${remote ? "remote" : "local"}).`);
