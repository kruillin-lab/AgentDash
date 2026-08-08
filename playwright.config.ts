import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3007",
  },
  webServer: {
    // Serve the production build on the exact loopback bind. The mock suite
    // drives the UI through API-level route mocks, so no live Hermes/CodeG
    // bridge is required; dispatch stays disabled.
    command: "npm run start",
    url: "http://127.0.0.1:3007/api/health",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
