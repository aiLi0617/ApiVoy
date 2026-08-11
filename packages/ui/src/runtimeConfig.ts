export interface ApiVoyRuntimeConfig { agentUrl?: string; agentToken?: string; collaborationUrl?: string }

export function runtimeConfig(): ApiVoyRuntimeConfig {
  return (window as Window & { __APIVOY_CONFIG__?: ApiVoyRuntimeConfig }).__APIVOY_CONFIG__ ?? {};
}

export function defaultCollaborationUrl(): string {
  return runtimeConfig().collaborationUrl ?? "http://localhost:8088";
}
