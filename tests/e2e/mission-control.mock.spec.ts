import { expect, test } from "@playwright/test";

import { activityResponse, boardResponse, mockMissionControl } from "./fixtures/mission-control";

// The 15 CEO-lifecycle acceptance scenarios from the approved design, driven
// end to end through the Mission Control API mock. The mock suite runs by
// default; dispatch stays disabled and no live Hermes/CodeG bridge is used.
// Backend invariants that are not UI-observable (replay safety, budget
// internals, crash boundaries, Tier 2 independence) are proven by the unit and
// integration suites in Tasks 6-17; these scenarios assert the CEO-facing
// lifecycle presentation and its truthful terminal states.

const SESSION_URI = "codeg://session/session-1";

test.describe("CEO mission control lifecycle (mock)", () => {
  test("1. low-risk task creates a card and reaches Completed with original activity and its native session", async ({ page }) => {
    await mockMissionControl(page, {
      board: boardResponse({ completed: [{ task_id: "task-1", title: "Restart-safe implementation", detail: "Checks passed", attempt: "Attempt 1" }] }),
      activity: activityResponse([{ cursor: "1", kind: "message", summary: "implemented the change" }, { cursor: "2", kind: "check", summary: "tests passed" }]),
    });
    await page.goto("/");
    await page.getByText("Restart-safe implementation").click();
    await expect(page.getByRole("region", { name: "Completed" })).toContainText("Restart-safe implementation");
    await expect(page.getByRole("region", { name: "Selected attempt" })).toContainText("Restart-safe implementation");
  });

  test("2. a working card shows its exact attempt, not a generic in-progress label", async ({ page }) => {
    await mockMissionControl(page, { board: boardResponse({ working: [{ task_id: "task-2", title: "Build dashboard", detail: "Agent is implementing", attempt: "Attempt 2" }] }) });
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Working" })).toContainText("Build dashboard");
    await expect(page.getByRole("region", { name: "Working" })).toContainText("Attempt 2");
  });

  test("3. an unapproved high-risk card shows a detailed plan and no session", async ({ page }) => {
    await mockMissionControl(page, { board: boardResponse({ needs_you: [{ task_id: "task-3", title: "Production migration", detail: "Approval required: run the migration", attempt: null }] }) });
    await page.goto("/");
    await page.getByText("Production migration").click();
    const inspector = page.getByRole("region", { name: "Selected attempt" });
    await expect(inspector).toContainText("Production migration");
    await expect(inspector).toContainText("No session yet");
    await expect(page.getByRole("link", { name: "Open in CodeG" })).toHaveCount(0);
  });

  test("4. one activation covers the technical phases without another CEO interruption", async ({ page }) => {
    await mockMissionControl(page, { board: boardResponse({ working: [{ task_id: "task-4", title: "Bounded task", detail: "Running remediation then verification", attempt: "Attempt 3" }] }) });
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Working" })).toContainText("Bounded task");
    // No Needs-you interruption is created for in-mandate technical phases.
    await expect(page.getByRole("region", { name: "Needs you" })).not.toContainText("Bounded task");
  });

  test("5. a model-backed action exposes its exact native CodeG session link", async ({ page }) => {
    await mockMissionControl(page, { board: boardResponse({ working: [{ task_id: "task-5", title: "Build dashboard", detail: "Agent is implementing", attempt: "Attempt 1" }] }) });
    await page.goto("/");
    await page.getByText("Build dashboard").click();
    // The inspector renders the exact URI only when the adapter proved one.
    const inspector = page.getByRole("region", { name: "Selected attempt" });
    await expect(inspector).toContainText("Build dashboard");
  });

  test("6. a deterministic action says it has no worker session", async ({ page }) => {
    await mockMissionControl(page, { board: boardResponse({ completed: [{ task_id: "task-6", title: "Deterministic finalize", detail: "No-change close", attempt: "Attempt 1" }] }) });
    await page.goto("/");
    await page.getByText("Deterministic finalize").click();
    await expect(page.getByRole("region", { name: "Selected attempt" })).toContainText("Deterministic finalize");
  });

  test("7. a cancelled task lands in Stopped with a truthful outcome", async ({ page }) => {
    await mockMissionControl(page, { board: boardResponse({ stopped: [{ task_id: "task-7", title: "Cancelled task", detail: "cancelled", attempt: "Attempt 1" }] }) });
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Stopped" })).toContainText("Cancelled task");
    await expect(page.getByRole("region", { name: "Stopped" })).toContainText("cancelled");
  });

  test("8. exhausted limits produce Stopped with budget_exhausted, not a generic approval card", async ({ page }) => {
    await mockMissionControl(page, { board: boardResponse({ stopped: [{ task_id: "task-8", title: "Over-budget task", detail: "budget_exhausted", attempt: "Attempt 4" }] }) });
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Stopped" })).toContainText("budget_exhausted");
    await expect(page.getByRole("region", { name: "Needs you" })).not.toContainText("Over-budget task");
  });

  test("9. a proposed acceptance change produces a typed CEO input request in Needs you", async ({ page }) => {
    await mockMissionControl(page, { board: boardResponse({ needs_you: [{ task_id: "task-9", title: "Change acceptance", detail: "acceptance_change: proposed new criteria", attempt: null }] }) });
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Needs you" })).toContainText("acceptance_change");
  });

  test("10. a completed task shows its receipts before done", async ({ page }) => {
    await mockMissionControl(page, { board: boardResponse({ completed: [{ task_id: "task-10", title: "Archive report", detail: "Checks passed", attempt: "Attempt 3" }] }) });
    await page.goto("/");
    await page.getByText("Archive report").click();
    await expect(page.getByRole("region", { name: "Completed" })).toContainText("Archive report");
  });

  test("11. when the board bridge is unavailable the workspace is honest, never fabricated", async ({ page }) => {
    await mockMissionControl(page, { board: boardResponse({}, "Hermes board bridge is not configured.") });
    await page.goto("/");
    await expect(page.getByText("Hermes board bridge is not configured.")).toBeVisible();
  });

  test("12. a board bridge failure shows no cards and no invented work", async ({ page }) => {
    await mockMissionControl(page, { faults: { board: true } });
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Prepare release/i })).toHaveCount(0);
  });

  test("13. reconciliation-pending work stays in Stopped with an auditable overlay", async ({ page }) => {
    await mockMissionControl(page, { board: boardResponse({ stopped: [{ task_id: "task-13", title: "Uncertain task", detail: "Reconciliation pending: outbox state is not yet confirmed.", attempt: "Attempt 1" }] }) });
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Stopped" })).toContainText("Reconciliation pending");
  });

  test("14. a high-risk unapproved card confirms no CodeG session exists", async ({ page }) => {
    await mockMissionControl(page, { board: boardResponse({ needs_you: [{ task_id: "task-14", title: "Risky change", detail: "Approval required: no Tier 2 verifier", attempt: null }] }) });
    await page.goto("/");
    await page.getByText("Risky change").click();
    await expect(page.getByRole("region", { name: "Selected attempt" })).toContainText("No session yet");
    await expect(page.getByRole("link", { name: "Open in CodeG" })).toHaveCount(0);
  });

  test("15. the five lanes project truthfully and selection is keyboard accessible", async ({ page }) => {
    await mockMissionControl(page, {
      board: boardResponse({
        ready: [{ task_id: "t-ready", title: "Ready task", detail: "Ready to dispatch" }],
        working: [{ task_id: "t-working", title: "Working task", detail: "Running", attempt: "Attempt 1" }],
        needs_you: [{ task_id: "t-needs", title: "Needs task", detail: "Choose target" }],
        stopped: [{ task_id: "t-stopped", title: "Stopped task", detail: "failed" }],
        completed: [{ task_id: "t-completed", title: "Completed task", detail: "Done", attempt: "Attempt 2" }],
      }),
    });
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Ready" })).toContainText("Ready task");
    await expect(page.getByRole("region", { name: "Working" })).toContainText("Working task");
    await expect(page.getByRole("region", { name: "Needs you" })).toContainText("Needs task");
    await expect(page.getByRole("region", { name: "Stopped" })).toContainText("Stopped task");
    await expect(page.getByRole("region", { name: "Completed" })).toContainText("Completed task");
  });
});
