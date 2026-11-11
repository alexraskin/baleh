/**
 * Prints the SQL Better Auth needs for the options in `worker/auth-options.ts`.
 * The Better Auth CLI can't reach D1, so we diff against an empty in-memory
 * SQLite database instead. Paste the output into a new D1 migration.
 *
 *   node scripts/print-auth-schema.ts
 */
import { DatabaseSync } from "node:sqlite";

import { getMigrations } from "better-auth/db/migration";

import { schemaOptions } from "../worker/auth-options.ts";

const { compileMigrations } = await getMigrations({
  ...schemaOptions,
  database: new DatabaseSync(":memory:"),
});

console.log(await compileMigrations());
