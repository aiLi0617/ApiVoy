import type { WorkbenchTab } from "./WorkbenchDeck";

export type WorkbenchCapability = "runner";

export interface WorkbenchRegistryEntry extends WorkbenchTab {
  capability?: WorkbenchCapability;
}

/**
 * Canonical workbench list. Nav grouping is independent (DEFAULT_WORKBENCH_GROUPS);
 * child panels must be rendered in this same order.
 */
export const WORKBENCH_REGISTRY: WorkbenchRegistryEntry[] = [
  { id: "http", label: "HTTP", protocols: ["http", "graphql", "soap", "jsonrpc"] },
  { id: "sse", label: "SSE", protocol: "sse" },
  { id: "socket", label: "TCP / UDP", protocols: ["tcp", "udp"] },
  { id: "websocket", label: "WebSocket", protocol: "websocket" },
  { id: "grpc", label: "gRPC", protocol: "grpc" },
  { id: "redis", label: "Redis", protocol: "redis" },
  { id: "mqtt", label: "MQTT", protocol: "mqtt" },
  { id: "amqp", label: "AMQP", protocol: "amqp" },
  { id: "kafka", label: "Kafka", protocol: "kafka" },
  { id: "sql", label: "SQL", protocol: "sql" },
  { id: "mock", label: "Mock" },
  { id: "runner", label: "Runner", capability: "runner" },
  { id: "gateway", label: "Gateway" },
  { id: "capture", label: "Capture" },
  { id: "plugins", label: "Plugins" },
  { id: "ai", label: "AI" },
];

export interface WorkbenchCapabilities {
  runner?: boolean;
}

export function buildWorkbenchTabs(capabilities: WorkbenchCapabilities = { runner: true }): WorkbenchTab[] {
  return WORKBENCH_REGISTRY
    .filter((entry) => !entry.capability || capabilities[entry.capability] !== false)
    .map(({ capability: _capability, ...tab }) => tab);
}
