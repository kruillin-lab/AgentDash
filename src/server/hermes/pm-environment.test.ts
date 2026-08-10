import { describe, expect, test } from "vitest";

import { DESIRED_LUISOS_PM_PROFILE, buildPMEnvironment } from "./pm-environment";

const profileHome = "C:\\isolated\\luisos-pm";

describe("buildPMEnvironment", () => {
  // Production break caught: a broad environment copy could expose controller, workspace, or tool credentials to the PM.
  test("constructs a new environment without forbidden parent keys", () => {
    const environment = buildPMEnvironment({
      source: {
        SystemRoot: "C:\\Windows",
        TEMP: "C:\\Temp",
        PATH: "C:\\attacker-bin",
        CODEG_TOKEN: "codeg-secret",
        CONTROLLER_COMMAND_SECRET: "controller-secret",
        WORKSPACE_CREDENTIAL: "workspace-secret",
        BROWSER_TOKEN: "browser-secret",
        COMPUTER_USE_KEY: "computer-secret",
        FILE_TOOL_TOKEN: "file-secret",
        SHELL_PASSWORD: "shell-secret",
        RESEARCH_API_KEY: "research-secret",
        DELEGATION_TOKEN: "delegate-secret",
        MEMORY_WRITE_TOKEN: "memory-secret",
      },
      profileHome,
    });

    expect(environment).toEqual({ SystemRoot: "C:\\Windows", TEMP: "C:\\Temp", HERMES_HOME: profileHome });
  });

  // Production break caught: case variants could leak a forbidden credential through the OS environment.
  test("excludes forbidden keys case-insensitively", () => {
    const environment = buildPMEnvironment({
      source: { SystemRoot: "C:\\Windows", cOdEg_ToKeN: "secret", Browser_Credential: "secret" },
      profileHome,
    });

    expect(Object.keys(environment).map((key) => key.toLowerCase())).not.toEqual(expect.arrayContaining(["codeg_token", "browser_credential"]));
  });

  // Production break caught: an implicit home could make Hermes load the global user profile instead of the isolated PM profile.
  test("requires an absolute explicitly allowed PM profile home", () => {
    expect(() => buildPMEnvironment({ source: {}, profileHome: "luisos-pm" })).toThrow(/absolute/i);
  });

  // Production break caught: candidate model names could silently become active before level-5 proof.
  test("documents Terra and Sonnet as inactive candidates with no PM tools", () => {
    expect(DESIRED_LUISOS_PM_PROFILE).toMatchObject({
      name: "luisos-pm",
      preferred_candidate: "gpt-5.6-terra",
      fallback_candidate: "claude-sonnet-5",
      inference_status: "inactive_pending_level_5",
      tools: [],
    });
    expect(DESIRED_LUISOS_PM_PROFILE.tools).not.toEqual(expect.arrayContaining(["shell", "files", "browser", "delegate"]));
  });
});
