import { isAbsolute } from "node:path";

const OPERATING_SYSTEM_KEYS = ["SystemRoot", "WINDIR", "TEMP", "TMP"] as const;

export const DESIRED_LUISOS_PM_PROFILE = Object.freeze({
  name: "luisos-pm",
  preferred_candidate: "gpt-5.6-terra",
  fallback_candidate: "claude-sonnet-5",
  inference_status: "inactive_pending_level_5",
  tools: Object.freeze([] as string[]),
});

export type PMEnvironmentOptions = {
  source: Readonly<Record<string, string | undefined>>;
  profileHome: string;
  inferenceModel?: string;
  inferenceProvider?: string;
};

function sourceValue(source: Readonly<Record<string, string | undefined>>, key: string): string | undefined {
  const match = Object.entries(source).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
  return match?.[1];
}

function boundedInferenceValue(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (!value || value.length > 256 || /[\0\r\n]/.test(value)) throw new TypeError(`${name} is invalid.`);
  return value;
}

/** Builds the complete PM child environment from an allowlist; the parent environment is never spread. */
export function buildPMEnvironment(options: PMEnvironmentOptions): Record<string, string> {
  if (!isAbsolute(options.profileHome)) throw new TypeError("PM profile home must be absolute.");

  const environment: Record<string, string> = {};
  for (const key of OPERATING_SYSTEM_KEYS) {
    const value = sourceValue(options.source, key);
    if (value) environment[key] = value;
  }
  environment.HERMES_HOME = options.profileHome;

  const inferenceModel = boundedInferenceValue(options.inferenceModel, "PM inference model");
  const inferenceProvider = boundedInferenceValue(options.inferenceProvider, "PM inference provider");
  if (inferenceModel) environment.HERMES_INFERENCE_MODEL = inferenceModel;
  if (inferenceProvider) environment.HERMES_INFERENCE_PROVIDER = inferenceProvider;
  return environment;
}
