export interface ProjectResponseValidationSettings {
  enabled: boolean;
  status: boolean;
  headers: boolean;
  bodyFormat: boolean;
  bodySchema: boolean;
  allowAdditionalProperties: boolean;
}

export const RESPONSE_VALIDATION_SETTINGS_EVENT = "apivoy-response-validation-settings";
export const DEFAULT_RESPONSE_VALIDATION_SETTINGS: ProjectResponseValidationSettings = {
  enabled: true, status: true, headers: true, bodyFormat: true, bodySchema: true, allowAdditionalProperties: true,
};

const key = (projectId: string) => `apivoy.project.${projectId}.response-validation`;
export function readResponseValidationSettings(projectId?: string): ProjectResponseValidationSettings {
  if (!projectId || typeof localStorage === "undefined") return DEFAULT_RESPONSE_VALIDATION_SETTINGS;
  try { return { ...DEFAULT_RESPONSE_VALIDATION_SETTINGS, ...JSON.parse(localStorage.getItem(key(projectId)) ?? "{}") }; }
  catch { return DEFAULT_RESPONSE_VALIDATION_SETTINGS; }
}
export function writeResponseValidationSettings(projectId: string, value: ProjectResponseValidationSettings) {
  localStorage.setItem(key(projectId), JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(RESPONSE_VALIDATION_SETTINGS_EVENT, { detail: { projectId, value } }));
}
