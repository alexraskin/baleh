import type { BetterAuthOptions } from "better-auth";
import { twoFactor } from "better-auth/plugins";

import { profileFieldDefinitions } from "../shared/profile.ts";

/**
 * The parts of the Better Auth config that shape the database schema. Kept free
 * of Worker-only imports so `scripts/print-auth-schema.ts` can load it in Node.
 */
export const schemaOptions = {
  emailAndPassword: { enabled: true },
  user: { additionalFields: profileFieldDefinitions },
  rateLimit: { storage: "database" },
  // TOTP + backup codes. Secrets and codes are stored encrypted with BETTER_AUTH_SECRET.
  plugins: [twoFactor({ issuer: "Baleh" })],
} satisfies BetterAuthOptions;
