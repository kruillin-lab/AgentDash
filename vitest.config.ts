import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const live = mode === "live";

  return {
    test: {
      environment: "node",
      include: live ? ["tests/live/**/*.test.{ts,tsx}", "src/**/*.live.test.{ts,tsx}"] : ["src/**/*.test.{ts,tsx}"],
      exclude: live ? [] : ["src/**/*.live.test.{ts,tsx}"],
      passWithNoTests: live,
      setupFiles: ["./vitest.setup.ts"],
    },
  };
});
