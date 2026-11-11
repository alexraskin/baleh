/**
 * Product branding. Everything user-facing that names the product reads from
 * here so a rename touches one file (plus `index.html` and `wrangler.jsonc`).
 */
export const brand = {
  name: "Baleh",
  supportEmail: "hello@baleh.dev",
} as const;

export function pageTitle(title?: string): string {
  return title ? `${title} · ${brand.name}` : brand.name;
}
