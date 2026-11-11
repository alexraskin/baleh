/** Hosts trusted on any port in development, since Vite moves ports when one is taken. */
const devHosts = ["localhost", "127.0.0.1"];

/** The app's origin plus its www. alias, which serves the same Worker. */
export function appOrigins(env: Env): string[] {
  const url = new URL(env.BETTER_AUTH_URL);
  const www = new URL(url);
  www.hostname = url.hostname.startsWith("www.") ? url.hostname.slice(4) : `www.${url.hostname}`;
  return [url.origin, www.origin];
}

export function isTrustedOrigin(origin: string, env: Env): boolean {
  if (appOrigins(env).includes(origin)) return true;
  if (env.ENVIRONMENT !== "development") return false;
  try {
    return devHosts.includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** Origin patterns in Better Auth's `trustedOrigins` format. */
export function trustedOriginPatterns(env: Env): string[] {
  const patterns = appOrigins(env);
  if (env.ENVIRONMENT === "development") {
    patterns.push(...devHosts.map((host) => `http://${host}:*`));
  }
  return patterns;
}
