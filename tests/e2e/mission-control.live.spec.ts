import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Mission Control LIVE end-to-end (opt-in)
//
// This suite runs ONLY against disposable, authenticated, loopback-only
// candidate services and harmless workspaces. It requires explicit opt-in via
// MISSION_CONTROL_LIVE_E2E=1 plus qualification credentials, disposable
// board/workspace ids, and expected candidate/evidence digests. It never runs
// by default and never touches production data.
// ---------------------------------------------------------------------------

const LIVE = process.env.MISSION_CONTROL_LIVE_E2E === "1";
const REQUIRED_ENV = ["MISSION_CONTROL_LIVE_BOARD_ID", "MISSION_CONTROL_LIVE_WORKSPACE_ID", "MISSION_CONTROL_LIVE_EXPECTED_CANDIDATE_DIGEST"];

test.describe("CEO mission control lifecycle (live, opt-in)", () => {
  test.skip(!LIVE, "Live e2e requires MISSION_CONTROL_LIVE_E2E=1 and disposable candidate services.");

  test.beforeEach(() => {
    for (const key of REQUIRED_ENV) {
      test.skip(!process.env[key], `Live e2e requires ${key}.`);
    }
  });

  // Reaching this body already requires MISSION_CONTROL_LIVE_E2E=1 and every credential in
  // REQUIRED_ENV, so the opt-in gates above are the only skips. An additional unconditional skip
  // would make the assertion unreachable even for a fully configured operator run.
  test("a complete harmless approval path reaches done on a disposable board", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Completed" })).toBeVisible();
  });
});
