/**
 * Shared request / execution DTOs mirrored from Rust `core-domain`.
 * Rust is the source of truth; this package is a hand-written mirror (codegen later via ts-rs/typeshare).
 */

export type ProtocolId =
  | "http"
  | "websocket"
  | "sse"
  | "graphql"
  | "grpc"
  | "tcp"
  | "udp"
  | string;

export interface HttpPayload {
  method: string;
  headers: Array<[string, string]>;
  body?: string | null;
  followRedirects: boolean;
}

export type ProtocolPayload =
  | ({ type: "http" } & HttpPayload)
  | { type: "raw"; value: unknown };

/** Request auth reference — secrets stay in Keychain / Agent secret-store. */
export interface AuthRef {
  /** `none` | `bearer` | `basic` | `api_key` */
  kind: string;
  /** Secret store name for bearer token, basic password, or API key. */
  secret_ref?: string | null;
  /** Basic auth username (may contain `{{var}}`). */
  username?: string | null;
  /** API Key header name (default `X-Api-Key`). */
  header_name?: string | null;
}

export interface RetryPolicy {
  max_retries: number;
  backoff_ms: number;
}

export interface TlsOptions {
  verify: boolean;
  client_cert_ref?: string | null;
}

export type Assertion =
  | { type: "status_equals"; expected: number }
  | { type: "status_in"; expected: number[] }
  | { type: "duration_lt"; max_ms: number }
  | { type: "size_lt"; max_bytes: number }
  | { type: "header_equals"; name: string; expected: string }
  | { type: "header_contains"; name: string; expected: string }
  | { type: "body_contains"; expected: string }
  | { type: "json_path_equals"; path: string; expected: string };

export interface RequestEnvelope {
  id: string;
  protocolId: ProtocolId;
  name: string;
  target: string;
  environmentRef?: string | null;
  authRef?: AuthRef | null;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  proxy?: string | null;
  tls: TlsOptions;
  metadata: unknown;
  payload: ProtocolPayload;
  preScripts: string[];
  postScripts: string[];
  assertions: Assertion[];
  variables: Record<string, string>;
  createdAt: string;
}

export type ExecutionState = "queued" | "running" | "completed" | "failed" | "cancelled";

export type ExecutionPhase =
  | "validate"
  | "resolve"
  | "pre_script"
  | "connect"
  | "transfer"
  | "post_script"
  | "assert"
  | "persist";

export interface ExecutionSummary {
  executionId: string;
  requestId: string;
  protocolId: string;
  state: ExecutionState;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  bytesReceived: number;
  status?: number | null;
}

export interface MetricEvent {
  name: string;
  value: number;
  unit: string;
}

export interface AssertionResultEvent {
  name: string;
  passed: boolean;
  expected?: string | null;
  actual?: string | null;
  message?: string | null;
}

export type ExecutionEvent =
  | { type: "state_changed"; state: ExecutionState; phase?: ExecutionPhase | null }
  | { type: "log"; level: string; message: string }
  | ({ type: "metric" } & MetricEvent)
  | {
      type: "response_meta";
      status?: number | null;
      statusText?: string | null;
      headers: Array<[string, string]>;
      contentType?: string | null;
      sizeHint?: number | null;
    }
  | {
      type: "response_chunk";
      contentType?: string | null;
      size: number;
      preview?: string | null;
      done: boolean;
    }
  | ({ type: "assertion_result" } & AssertionResultEvent)
  | { type: "warning"; code: string; message: string }
  | { type: "completed"; summary: ExecutionSummary }
  | { type: "failed"; code: string; message: string }
  | { type: "cancelled"; reason?: string | null };

export interface CreateHttpRequestOptions {
  name?: string;
  url: string;
  method?: string;
  headers?: Array<[string, string]>;
  body?: string | null;
  timeoutMs?: number;
  followRedirects?: boolean;
  variables?: Record<string, string>;
  assertions?: Assertion[];
  auth?: AuthRef | null;
  environmentRef?: string | null;
}

export function createHttpRequest(options: CreateHttpRequestOptions): RequestEnvelope {
  const method = (options.method ?? "GET").toUpperCase();
  return {
    id: crypto.randomUUID(),
    protocolId: "http",
    name: options.name ?? `${method} ${options.url}`,
    target: options.url,
    environmentRef: options.environmentRef ?? null,
    authRef: options.auth ?? null,
    timeoutMs: options.timeoutMs ?? 30_000,
    retryPolicy: { max_retries: 0, backoff_ms: 0 },
    proxy: null,
    tls: { verify: true, client_cert_ref: null },
    metadata: {},
    payload: {
      type: "http",
      method,
      headers: options.headers ?? [],
      body: options.body ?? null,
      followRedirects: options.followRedirects ?? true,
    },
    preScripts: [],
    postScripts: [],
    assertions: options.assertions ?? [],
    variables: options.variables ?? {},
    createdAt: new Date().toISOString(),
  };
}

export function createHttpGetRequest(name: string, url: string): RequestEnvelope {
  return createHttpRequest({ name, url, method: "GET" });
}

/** Protocol API version expected by Web/Desktop clients (must match Agent). */
export const PROTOCOL_API_VERSION = "1";

export const CLIENT_VERSION = "0.1.0";
