import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const live = mode === "live";

  return {
    // Mirrors tsconfig's "@/*" -> "./src/*". Without it, every module that imports through
    // the alias is unloadable under test, which is why the API route handlers had no tests.
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    test: {
      environment: "node",
      include: live ? ["tests/live/**/*.test.{ts,tsx}", "src/**/*.live.test.{ts,tsx}"] : ["src/**/*.test.{ts,tsx}"],
      exclude: live ? [] : ["src/**/*.live.test.{ts,tsx}"],
      passWithNoTests: live,
      setupFiles: ["./vitest.setup.ts"],
    },
  };
});
