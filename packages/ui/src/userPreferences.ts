import { defaultCollaborationUrl, runtimeConfig } from "./runtimeConfig";

export const PREFERENCES_CHANGED_EVENT = "apivoy-preferences-changed";

export type PreferenceKey =
  | "collaborationUrl"
  | "aiEndpoint"
  | "aiModel"
  | "aiSecretRef"
  | "gatewayUrl"
  | "gatewayKey"
  | "agentUrl"
  | "agentToken";

const KEYS = {
  collaborationUrl: "apivoy:collaboration-url",
  aiEndpoint: "apivoy:ai-endpoint",
  aiModel: "apivoy:ai-model",
  aiSecretRef: "apivoy:ai-secret-ref",
  gatewayUrl: "apivoy:gateway-url",
  gatewayKey: "apivoy:gateway-key",
  agentUrl: "apivoy:agent-url",
  agentToken: "apivoy-agent-token",
} as const;

const DEFAULT_AI = {
  endpoint: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  secretRef: "ai-provider-key",
} as const;

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function emitChanged(keys: PreferenceKey[]): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PREFERENCES_CHANGED_EVENT, { detail: { keys } }));
}

function defaultGatewayUrl(): string {
  if (typeof location === "undefined") return "/gateway";
  return `${location.origin}/gateway`;
}

function defaultAgentUrl(): string {
  return runtimeConfig().agentUrl ?? "http://127.0.0.1:39217";
}

function defaultAgentToken(): string {
  return runtimeConfig().agentToken ?? "";
}

export function getCollaborationUrl(): string {
  return readLocal(KEYS.collaborationUrl) ?? defaultCollaborationUrl();
}

export function setCollaborationUrl(value: string): void {
  if (getCollaborationUrl() === value) return;
  writeLocal(KEYS.collaborationUrl, value);
  emitChanged(["collaborationUrl"]);
}

export function getAiEndpoint(): string {
  return readLocal(KEYS.aiEndpoint) ?? DEFAULT_AI.endpoint;
}

export function setAiEndpoint(value: string): void {
  if (getAiEndpoint() === value) return;
  writeLocal(KEYS.aiEndpoint, value);
  emitChanged(["aiEndpoint"]);
}

export function getAiModel(): string {
  return readLocal(KEYS.aiModel) ?? DEFAULT_AI.model;
}

export function setAiModel(value: string): void {
  if (getAiModel() === value) return;
  writeLocal(KEYS.aiModel, value);
  emitChanged(["aiModel"]);
}

export function getAiSecretRef(): string {
  return readLocal(KEYS.aiSecretRef) ?? DEFAULT_AI.secretRef;
}

export function setAiSecretRef(value: string): void {
  if (getAiSecretRef() === value) return;
  writeLocal(KEYS.aiSecretRef, value);
  emitChanged(["aiSecretRef"]);
}

export function getGatewayUrl(): string {
  return readSession(KEYS.gatewayUrl) ?? defaultGatewayUrl();
}

export function setGatewayUrl(value: string): void {
  if (getGatewayUrl() === value) return;
  writeSession(KEYS.gatewayUrl, value);
  emitChanged(["gatewayUrl"]);
}

export function getGatewayKey(): string {
  return readSession(KEYS.gatewayKey) ?? "";
}

export function setGatewayKey(value: string): void {
  if (getGatewayKey() === value) return;
  writeSession(KEYS.gatewayKey, value);
  emitChanged(["gatewayKey"]);
}

/** User override → runtime inject → built-in default. */
export function getAgentUrl(): string {
  return readLocal(KEYS.agentUrl) ?? defaultAgentUrl();
}

export function setAgentUrl(value: string): void {
  const next = value.trim();
  const current = getAgentUrl();
  if (!next) {
    try { localStorage.removeItem(KEYS.agentUrl); } catch { /* ignore */ }
    if (current !== defaultAgentUrl()) emitChanged(["agentUrl"]);
    return;
  }
  if (current === next) return;
  writeLocal(KEYS.agentUrl, next);
  emitChanged(["agentUrl"]);
}

export function getAgentToken(): string {
  return readLocal(KEYS.agentToken) ?? defaultAgentToken();
}

export function setAgentToken(value: string): void {
  if (getAgentToken() === value) return;
  writeLocal(KEYS.agentToken, value);
  emitChanged(["agentToken"]);
}

export function getUserPreferencesSnapshot() {
  return {
    collaborationUrl: getCollaborationUrl(),
    aiEndpoint: getAiEndpoint(),
    aiModel: getAiModel(),
    aiSecretRef: getAiSecretRef(),
    gatewayUrl: getGatewayUrl(),
    gatewayKey: getGatewayKey(),
    agentUrl: getAgentUrl(),
    agentToken: getAgentToken(),
  };
}

export type UserPreferencesSnapshot = ReturnType<typeof getUserPreferencesSnapshot>;

export function subscribePreferences(listener: (keys: PreferenceKey[]) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ keys?: PreferenceKey[] }>).detail;
    listener(detail?.keys ?? []);
  };
  window.addEventListener(PREFERENCES_CHANGED_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(PREFERENCES_CHANGED_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
