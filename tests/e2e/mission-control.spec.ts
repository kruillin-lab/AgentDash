import { expect, test } from "@playwright/test";

const taskId = "task-1280-layout";
const summary = JSON.stringify({
  schema_version: "agentdash.mission-control-card-view/v1",
  task_id: taskId,
  title: "Prepare release",
  detail: "Ready to dispatch",
  attempt: "attempt-7",
});

const boardResponse = {
  board: {
    generated_at: "2026-08-04T12:00:00.000Z",
    lanes: {
      ready: [{ redacted: true, digest: "a".repeat(64), summary }],
      working: [],
      needs_you: [],
      stopped: [],
      completed: [],
    },
    archived_count: 0,
    unavailable_reason: null,
  },
  unavailable_reason: null,
};

test.use({ viewport: { width: 1280, height: 720 } });

test("keeps the selected inspector inside the visible main pane at 1280px", async ({ page }) => {
  await page.route("**/api/mission-control/board", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(boardResponse),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Prepare release/i }).click();

  const inspector = page.getByRole("region", { name: "Selected attempt" });
  await expect(inspector).toContainText("Prepare release");

  const appMain = page.locator("main").first();
  const layout = page.getByTestId("mission-control-layout");
  const [mainBox, layoutBox, inspectorBox] = await Promise.all([
    appMain.boundingBox(),
    layout.boundingBox(),
    inspector.boundingBox(),
  ]);

  expect(mainBox).not.toBeNull();
  expect(layoutBox).not.toBeNull();
  expect(inspectorBox).not.toBeNull();

  const mainRight = mainBox!.x + mainBox!.width;
  const layoutRight = layoutBox!.x + layoutBox!.width;
  const inspectorRight = inspectorBox!.x + inspectorBox!.width;

  expect(layoutRight, `layout=${JSON.stringify(layoutBox)} main=${JSON.stringify(mainBox)}`).toBeLessThanOrEqual(mainRight + 0.5);
  expect(inspectorRight, `inspector=${JSON.stringify(inspectorBox)} main=${JSON.stringify(mainBox)}`).toBeLessThanOrEqual(mainRight + 0.5);
});
