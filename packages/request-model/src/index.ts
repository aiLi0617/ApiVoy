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
  multipart?: MultipartPart[];
  followRedirects: boolean;
}

export interface MultipartPart {
  name: string;
  value: string;
  fileName?: string | null;
  contentType?: string | null;
  base64?: boolean;
}

export interface SsePayload {
  headers: Array<[string, string]>;
  lastEventId?: string | null;
  reconnectMax?: number;
  reconnectDelayMs?: number;
}
export interface SocketPayload { data: string; encoding: "text" | "hex" | string; framing?: "none" | "delimiter" | "fixed" | string | null; delimiter?: string | null; fixedLength?: number | null; sendCount?: number; intervalMs?: number; tls?: boolean; serverName?: string | null; caCertRef?: string | null }
export interface UdpPayload { data: string; encoding: "text" | "hex" | string; sendCount: number; intervalMs: number }
export interface GraphqlPayload { query: string; variables: unknown; operationName?: string | null; headers: Array<[string, string]> }
export interface WebSocketPayload { headers: Array<[string, string]>; subprotocols: string[]; messages: Array<{ encoding: "text" | "binary" | string; data: string }>; receiveLimit?: number | null; reconnectMax?: number; reconnectDelayMs?: number }
export interface GrpcPayload { service: string; method: string; messageBase64: string; mode: "unary" | "server_streaming" | string; metadata: Array<[string, string]>; descriptorSetBase64?: string | null; messageJson?: string | null }

export type ProtocolPayload =
  | ({ type: "http" } & HttpPayload)
  | ({ type: "sse" } & SsePayload)
  | ({ type: "tcp" } & SocketPayload)
  | ({ type: "udp" } & UdpPayload)
  | ({ type: "graphql" } & GraphqlPayload)
  | ({ type: "websocket" } & WebSocketPayload)
  | ({ type: "grpc" } & GrpcPayload)
  | { type: "raw"; value: unknown };

/** Request auth reference — secrets stay in Keychain / Agent secret-store. */
export interface AuthRef {
  /** `none` | `bearer` | `basic` | `api_key` | `oauth2_client_credentials` */
  kind: string;
  /** Secret store name for bearer token, basic password, or API key. */
  secret_ref?: string | null;
  /** Basic auth username (may contain `{{var}}`). */
  username?: string | null;
  /** API Key header name (default `X-Api-Key`). */
  header_name?: string | null;
  token_url?: string | null;
  scope?: string | null;
  audience?: string | null;
  authorization_url?: string | null;
  redirect_uri?: string | null;
  authorization_code_ref?: string | null;
  code_verifier_ref?: string | null;
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

export interface ResponseMeta {
  status?: number | null;
  statusText?: string | null;
  headers: Array<[string, string]>;
  contentType?: string | null;
  sizeHint?: number | null;
}

export type ExecutionEvent =
  | { type: "state_changed"; state: ExecutionState; phase?: ExecutionPhase | null }
  | { type: "log"; level: string; message: string }
  | { type: "variables_extracted"; variables: Record<string, string> }
  | ({ type: "metric" } & MetricEvent)
  | ({ type: "response_meta" } & ResponseMeta)
  | {
      type: "response_chunk";
      contentType?: string | null;
      size: number;
      preview?: string | null;
      dataBase64?: string | null;
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
  multipart?: MultipartPart[];
  timeoutMs?: number;
  followRedirects?: boolean;
  variables?: Record<string, string>;
  assertions?: Assertion[];
  auth?: AuthRef | null;
  environmentRef?: string | null;
  retryPolicy?: RetryPolicy;
  proxy?: string | null;
  tls?: TlsOptions;
  preScripts?: string[];
  postScripts?: string[];
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
    retryPolicy: options.retryPolicy ?? { max_retries: 0, backoff_ms: 0 },
    proxy: options.proxy ?? null,
    tls: options.tls ?? { verify: true, client_cert_ref: null },
    metadata: {},
    payload: {
      type: "http",
      method,
      headers: options.headers ?? [],
      body: options.body ?? null,
      multipart: options.multipart ?? [],
      followRedirects: options.followRedirects ?? true,
    },
    preScripts: options.preScripts ?? [],
    postScripts: options.postScripts ?? [],
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
