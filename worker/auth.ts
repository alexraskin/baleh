import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { captcha, haveIBeenPwned } from "better-auth/plugins";
import { z } from "zod";

import {
  emailSchema,
  PASSWORD_BREACHED,
  passwordSchema,
  signInSchema,
  signUpSchema,
} from "../shared/profile.ts";
import { deleteAccountData } from "./account.ts";
import { schemaOptions } from "./auth-options.ts";
import { RESET_TTL_SECONDS, sendAccountEmail, VERIFICATION_TTL_SECONDS } from "./email.ts";
import { appOrigins, trustedOriginPatterns } from "./origins.ts";

export const AUTH_BASE_PATH = "/api/auth";

/** Better Auth endpoints we don't expose; profile writes go through our validated API. */
const disabledPaths = [
  "/update-user",
  // Email OTP isn't configured; TOTP and backup codes only.
  "/two-factor/send-otp",
  "/two-factor/verify-otp",
];

const passwordBody = z.object({ password: z.string().min(1, "Enter your password.").max(128) });

/** Request bodies Better Auth accepts, validated with the same rules the client uses. */
const bodySchemas: Record<string, z.ZodType> = {
  "/sign-up/email": signUpSchema,
  "/sign-in/email": signInSchema,
  "/request-password-reset": z.object({ email: emailSchema }).loose(),
  "/reset-password": z.object({ newPassword: passwordSchema }).loose(),
  "/send-verification-email": z.object({ email: emailSchema }).loose(),
  "/change-email": z.object({ newEmail: emailSchema }).loose(),
  // Always sign out other devices: the "password changed" email promises it.
  "/change-password": z
    .object({
      currentPassword: z.string().min(1, "Enter your current password.").max(128),
      newPassword: passwordSchema,
      revokeOtherSessions: z.literal(true),
    })
    .loose(),
  // Always confirm with the password, however fresh the session.
  "/delete-user": passwordBody.loose(),
  "/two-factor/enable": passwordBody.loose(),
  "/two-factor/disable": passwordBody.loose(),
  "/two-factor/get-totp-uri": passwordBody.loose(),
  "/two-factor/generate-backup-codes": passwordBody.loose(),
  "/two-factor/verify-totp": z
    .object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code.") })
    .loose(),
  "/two-factor/verify-backup-code": z
    .object({ code: z.string().min(1, "Enter a backup code.").max(32) })
    .loose(),
};

function buildAuth(env: Env) {
  const appUrl = (path: string) => new URL(path, env.BETTER_AUTH_URL).toString();

  return betterAuth({
    ...schemaOptions,
    appName: "Baleh",
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: AUTH_BASE_PATH,
    trustedOrigins: trustedOriginPatterns(env),
    telemetry: { enabled: false },
    disabledPaths,
    // Turnstile on sign-up, sign-in and password-reset requests. Off without a secret key.
    // The action must match the widget's (turnstile-widget.tsx). Hostnames are only pinned
    // in production: Cloudflare's test keys report a placeholder hostname.
    plugins: [
      ...schemaOptions.plugins,
      // Reject passwords seen in breaches (sign-up, change, reset). Only a 5-char SHA-1
      // prefix leaves the Worker. Fails closed: if the API is down, password writes 500.
      haveIBeenPwned({ customPasswordCompromisedMessage: PASSWORD_BREACHED }),
      ...(env.TURNSTILE_SECRET_KEY
        ? [
            captcha({
              provider: "cloudflare-turnstile",
              secretKey: env.TURNSTILE_SECRET_KEY,
              expectedAction: "auth",
              allowedHostnames:
                env.ENVIRONMENT === "production"
                  ? appOrigins(env).map((origin) => new URL(origin).hostname)
                  : undefined,
            }),
          ]
        : []),
    ],
    user: {
      ...schemaOptions.user,
      changeEmail: {
        enabled: true,
        // Verified accounts approve the change from the old address first; the new
        // address then gets a normal verification link (sendVerificationEmail).
        sendChangeEmailConfirmation: async ({ user, url, token }) => {
          sendAccountEmail(env, `change-email:${token}`, {
            kind: "change-email",
            to: user.email,
            name: user.name,
            url,
          });
        },
      },
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => deleteAccountData(env, user.id),
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: !isSignUpEnabled(env),
      // Invitations are bound to an email address, so it has to be proven first.
      requireEmailVerification: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: RESET_TTL_SECONDS,
      sendResetPassword: async ({ user, url, token }) => {
        sendAccountEmail(env, `reset-password:${token}`, {
          kind: "reset-password",
          to: user.email,
          name: user.name,
          url,
        });
      },
      onPasswordReset: async ({ user }) => {
        sendAccountEmail(env, `password-changed:${crypto.randomUUID()}`, {
          kind: "password-changed",
          to: user.email,
          name: user.name,
          url: appUrl("/forgot-password"),
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // Signing in unverified sends a fresh link (rate limited with sign-in).
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: VERIFICATION_TTL_SECONDS,
      sendVerificationEmail: async ({ user, url, token }) => {
        sendAccountEmail(env, `verify-email:${token}`, {
          kind: "verify-email",
          to: user.email,
          name: user.name,
          url,
        });
      },
      afterEmailVerification: async (user) => {
        sendAccountEmail(env, `welcome:${user.id}`, {
          kind: "welcome",
          to: user.email,
          name: user.name,
          url: appUrl("/rooms"),
        });
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // Signed copy of the session in a cookie, so most requests skip D1. Trade-off: a
      // revoked session (sign-out elsewhere, password reset) keeps working up to maxAge.
      // Profile writes send a fresh cache cookie back (withFreshSession).
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    rateLimit: {
      ...schemaOptions.rateLimit,
      enabled: env.ENVIRONMENT === "production",
    },
    // Cloudflare sets cf-connecting-ip and overwrites any client-sent value. The default,
    // x-forwarded-for, is missing on Workers, so every client shared one rate-limit bucket.
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    databaseHooks: {
      user: {
        update: {
          // Under /two-factor/* the user row only changes when 2FA is turned on or off.
          after: async (user, ctx) => {
            if (!ctx?.path.startsWith("/two-factor/")) return;
            sendAccountEmail(env, `two-factor:${crypto.randomUUID()}`, {
              kind: user.twoFactorEnabled ? "two-factor-enabled" : "two-factor-disabled",
              to: user.email,
              name: user.name,
              url: appUrl("/forgot-password"),
            });
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const schema = bodySchemas[ctx.path];
        if (!schema) return;
        const result = schema.safeParse(ctx.body);
        if (!result.success) {
          throw new APIError("BAD_REQUEST", {
            message: result.error.issues[0]?.message ?? "Invalid request",
          });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/change-password") return;
        // Only set when the change succeeded (other sessions revoked, a new one issued).
        const user = ctx.context.newSession?.user;
        if (!user) return;
        sendAccountEmail(env, `password-changed:${crypto.randomUUID()}`, {
          kind: "password-changed",
          to: user.email,
          name: user.name,
          url: appUrl("/forgot-password"),
        });
      }),
    },
  });
}

export type Auth = ReturnType<typeof buildAuth>;

/**
 * A fresh Better Auth instance per request. Don't cache it per isolate: it starts an
 * init promise in the first request, and if that request is canceled (tab closed,
 * reload) the promise never settles and every later request in the isolate hangs.
 */
export function getAuth(env: Env): Auth {
  return buildAuth(env);
}

export function isSignUpEnabled(env: Env): boolean {
  return String(env.SIGNUPS_ENABLED) === "true";
}
