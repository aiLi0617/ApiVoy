import { CLIENT_VERSION, PROTOCOL_API_VERSION, type RequestEnvelope } from "@apivoy/request-model";
import type { WorkspaceTree } from "@apivoy/ui";
import { agentBaseUrl, checkAgentHandshake } from "./agentClient";

/** Abort-aware workspace bootstrap. The preliminary health request also bounds offline Agent waits. */
export async function getWorkspaceTreeAbortable(signal: AbortSignal): Promise<WorkspaceTree> {
  const health = await fetch(`${agentBaseUrl}/health`, { signal });
  if (!health.ok) throw new Error(`Agent health check failed: ${health.status}`);
  await checkAgentHandshake();
  if (signal.aborted) throw signal.reason;
  const headers = new Headers({
    "Content-Type": "application/json",
    "X-ApiVoy-Protocol-Api-Version": PROTOCOL_API_VERSION,
    "X-ApiVoy-Client": "web",
    "X-ApiVoy-Client-Version": CLIENT_VERSION,
  });
  const token = localStorage.getItem("apivoy-agent-token");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${agentBaseUrl}/v1/workspace-tree`, { headers, signal });
  if (!response.ok) throw new Error(await response.text());
  const raw = await response.json() as Omit<WorkspaceTree, "requests"> & { requests: Array<WorkspaceTree["requests"][number] & { envelope?: RequestEnvelope }> };
  return { ...raw, requests: raw.requests.map((item) => ({
    ...item,
    method: item.envelope?.payload.type === "http" ? item.envelope.payload.method : item.method,
  })) };
}
