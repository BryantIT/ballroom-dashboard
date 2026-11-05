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
  },
});
