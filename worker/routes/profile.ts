import { defaultLanguage, isLanguageCode, languageCodes } from "../../shared/languages.ts";
import {
  updateLanguageSchema,
  updateProfileSchema,
  type Profile,
  type UpdateProfileInput,
} from "../../shared/profile.ts";
import type { Auth } from "../auth.ts";
import { HttpError, json, parseJson } from "../http.ts";
import { notifyProfileChanged, notifyUsers } from "../rooms.ts";
import { assertSameOrigin, requireUser, withFreshSession } from "../session.ts";
import { backfillTranslations } from "../translation.ts";

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  preferredLanguage: string;
  avatarUrl: string | null;
  createdAt: string | number;
}

function toProfile(row: UserRow): Profile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    preferredLanguage: isLanguageCode(row.preferredLanguage)
      ? row.preferredLanguage
      : defaultLanguage,
    avatarUrl: row.avatarUrl,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

async function loadProfile(db: D1Database, userId: string): Promise<Profile> {
  const row = await db
    .prepare(
      `select "id", "email", "displayName", "preferredLanguage", "avatarUrl", "createdAt"
       from "user" where "id" = ?`,
    )
    .bind(userId)
    .first<UserRow>();
  if (!row) throw new HttpError(404, "User not found");
  return toProfile(row);
}

const updatableColumns = ["displayName", "preferredLanguage"] as const;

async function saveProfile(db: D1Database, userId: string, changes: UpdateProfileInput) {
  const columns = updatableColumns.filter((column) => changes[column] !== undefined);
  const assignments = columns.map((column) => `"${column}" = ?`);
  const values = columns.map((column) => changes[column] ?? null);

  // `name` mirrors displayName so Better Auth's own session payload stays in sync.
  if (changes.displayName !== undefined) {
    assignments.push(`"name" = ?`);
    values.push(changes.displayName);
  }

  await db
    .prepare(`update "user" set ${assignments.join(", ")}, "updatedAt" = ? where "id" = ?`)
    .bind(...values, new Date().toISOString(), userId)
    .run();
}

export async function getMe(request: Request, env: Env, auth: Auth) {
  const user = await requireUser(auth, request);
  return json(await loadProfile(env.DB, user.id));
}

export async function patchMe(request: Request, env: Env, auth: Auth) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  const changes = await parseJson(request, updateProfileSchema);
  await saveProfile(env.DB, user.id, changes);
  if (changes.preferredLanguage) {
    backfillTranslations(env.DB, env.TRANSLATIONS, user.id);
  }
  notifyProfileChanged(env, user.id);
  return withFreshSession(auth, request, json(await loadProfile(env.DB, user.id)));
}

export async function putLanguage(request: Request, env: Env, auth: Auth) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  const { preferredLanguage } = await parseJson(request, updateLanguageSchema);
  await saveProfile(env.DB, user.id, { preferredLanguage });
  backfillTranslations(env.DB, env.TRANSLATIONS, user.id);
  notifyUsers(env, [user.id], { type: "profile-changed" });
  return withFreshSession(auth, request, json({ preferredLanguage }));
}

export function getLanguages() {
  return json({ languages: languageCodes, default: defaultLanguage });
}
