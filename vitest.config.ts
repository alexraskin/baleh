import path from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const secrets = {
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
  MESSAGE_KEY: "dGVzdC1tZXNzYWdlLWtleS0zMi1ieXRlcy1sb25nISE=",
  // A throwaway pair for tests only
  VAPID_PUBLIC_KEY:
    "BOlgPlowJsG1m4sH7cFjOGzBKXf__IypeB3IhDlvVExMrT4gdIBQWQaL1WvDXZLdjPVB6GINrGm9hJUuWgQefO8",
  VAPID_PRIVATE_KEY: "ZX9SO0YR6Sg6cI8E4UKyNyKfy0MM-Hv-fnWtMGWMNcI",
  TURNSTILE_SECRET_KEY: "",
};

// Wrangler checks `secrets.required` against .dev.vars/.env/process.env before the
// bindings below apply, and warns in CI where neither file exists.
for (const [key, value] of Object.entries(secrets)) process.env[key] ??= value;

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
          ENVIRONMENT: "test",
          BETTER_AUTH_URL: "http://localhost:5173",
          SIGNUPS_ENABLED: "true",
          TURNSTILE_SITE_KEY: "",
          ...secrets,
        },
      },
    })),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
