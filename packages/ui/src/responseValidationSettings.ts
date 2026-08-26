export interface ProjectResponseValidationSettings {
  enabled: boolean;
  interfaceRun: boolean;
  singleCase: boolean;
  testScenario: boolean;
  status: boolean;
  headers: boolean;
  bodyFormat: boolean;
  bodySchema: boolean;
  allowAdditionalProperties: boolean;
}

export const RESPONSE_VALIDATION_SETTINGS_EVENT = "apivoy-response-validation-settings";
export const DEFAULT_RESPONSE_VALIDATION_SETTINGS: ProjectResponseValidationSettings = {
  enabled: true, interfaceRun: true, singleCase: true, testScenario: true,
  status: true, headers: true, bodyFormat: true, bodySchema: true, allowAdditionalProperties: true,
};

const key = (projectId: string) => `apivoy.project.${projectId}.response-validation`;
export function readResponseValidationSettings(projectId?: string): ProjectResponseValidationSettings {
  if (!projectId || typeof localStorage === "undefined") return DEFAULT_RESPONSE_VALIDATION_SETTINGS;
  try {
    const stored = JSON.parse(localStorage.getItem(key(projectId)) ?? "{}") as Partial<ProjectResponseValidationSettings>;
    const legacyEnabled = stored.enabled ?? DEFAULT_RESPONSE_VALIDATION_SETTINGS.enabled;
    return {
      ...DEFAULT_RESPONSE_VALIDATION_SETTINGS,
      ...stored,
      interfaceRun: stored.interfaceRun ?? legacyEnabled,
      singleCase: stored.singleCase ?? legacyEnabled,
      testScenario: stored.testScenario ?? legacyEnabled,
      enabled: stored.interfaceRun ?? legacyEnabled,
    };
  }
  catch { return DEFAULT_RESPONSE_VALIDATION_SETTINGS; }
}
export function writeResponseValidationSettings(projectId: string, value: ProjectResponseValidationSettings) {
  const normalized = { ...value, enabled: value.interfaceRun };
  localStorage.setItem(key(projectId), JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(RESPONSE_VALIDATION_SETTINGS_EVENT, { detail: { projectId, value: normalized } }));
}
