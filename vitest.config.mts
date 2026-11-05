import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: {
      // The real "server-only" package resolves to a stub that throws
      // unless the resolver's "react-server" export condition is active.
      // Vitest doesn't (and shouldn't, globally) set that condition — doing
      // so would change how react/react-dom/Next internals resolve for
      // jsdom component tests. Instead, alias just this one package to a
      // no-op module so server-only modules (e.g. lib/db/client.ts) can be
      // imported in tests without tripping the "Client Component" guard.
      "server-only": path.resolve(
        __dirname,
        "vitest.setup/server-only-mock.ts"
      ),
    },
  },
  test: {
    environment: "jsdom",
    server: {
      // next-auth@beta imports "next/server" without a file extension.
      // Vitest externalizes node_modules packages by default, handing
      // that import straight to Node's native ESM resolver, which (unlike
      // Vite's own resolver) requires an exact extension and has no
      // "exports" map to fall back on for this package — it fails with
      // "Cannot find module .../next/server". Inlining next-auth routes
      // it through Vite's resolver instead, which tolerates this.
      deps: {
        inline: ["next-auth"],
      },
    },
  },
});
