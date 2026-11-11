import { fileURLToPath, URL } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({
      auxiliaryWorkers: [{ configPath: "./translator/wrangler.jsonc" }],
      // Workers AI has no local simulator, so dev calls the real one (needs `wrangler login`).
      // BALEH_OFFLINE=1 skips that; translations then fail and show the original.
      remoteBindings: !process.env.BALEH_OFFLINE,
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
});
