import { useState } from "react";
import type { HttpRunResult, HttpSendHooks } from "./HttpWorkbench";
import { Checkbox, Select, Textarea, TextInput } from "./Components";
import { ProtocolField, ProtocolFormCard, ProtocolFormGrid, ProtocolFormOptions } from "./ProtocolForm";
import { ProtocolWorkbenchLayout } from "./ProtocolWorkbenchLayout";
import { useWorkbenchHydration } from "./useWorkbenchHydration";

export interface AmqpWorkbenchRequest {
  name: string; target: string; mode: "publish" | "consume"; username: string; passwordRef: string;
  exchange: string; exchangeType: "direct" | "fanout" | "topic" | "headers"; routingKey: string;
  queue: string; declare: boolean; durable: boolean; autoAck: boolean; receiveLimit: number;
  payload: string; encoding: "text" | "base64"; contentType: string; timeoutMs: number;
}
export interface AmqpWorkbenchProps {
  onSend: (request: AmqpWorkbenchRequest, hooks?: HttpSendHooks) => Promise<HttpRunResult>;
  onSave?: (request: AmqpWorkbenchRequest) => Promise<void>;
  onCancel?: (executionId: string) => Promise<void>;
}

export function AmqpWorkbench({ onSend, onSave, onCancel }: AmqpWorkbenchProps) {
  const [name, setName] = useState("AMQP request"); const [target, setTarget] = useState("amqp://127.0.0.1:5672/%2f");
  const [mode, setMode] = useState<"publish" | "consume">("publish"); const [username, setUsername] = useState("guest");
  const [passwordRef, setPasswordRef] = useState("amqp-password"); const [exchange, setExchange] = useState("amq.topic");
  const [exchangeType, setExchangeType] = useState<AmqpWorkbenchRequest["exchangeType"]>("topic");
  const [routingKey, setRoutingKey] = useState("apivoy.demo"); const [queue, setQueue] = useState("apivoy-demo");
  const [declare, setDeclare] = useState(true); const [durable, setDurable] = useState(false); const [autoAck, setAutoAck] = useState(false);
  const [receiveLimit, setReceiveLimit] = useState(1); const [payload, setPayload] = useState('{"hello":"amqp"}');
  const [encoding, setEncoding] = useState<"text" | "base64">("text"); const [contentType, setContentType] = useState("application/json");
  const [result, setResult] = useState<HttpRunResult | null>(null); const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false); const [executionId, setExecutionId] = useState<string | null>(null);

  useWorkbenchHydration("amqp", (detail) => {
    const envelope = detail as { protocolId?: string; name?: string; target?: string; payload?: { type?: string; value?: Partial<AmqpWorkbenchRequest> } & Partial<AmqpWorkbenchRequest> };
    if (envelope.protocolId !== "amqp" || envelope.payload?.type !== "raw") return;
    const value = envelope.payload.value ?? envelope.payload;
    setName(envelope.name ?? ""); setTarget(envelope.target ?? ""); setMode(value.mode ?? "publish");
    setUsername(value.username ?? ""); setPasswordRef(value.passwordRef ?? ""); setExchange(value.exchange ?? "");
    setExchangeType(value.exchangeType ?? "direct"); setRoutingKey(value.routingKey ?? ""); setQueue(value.queue ?? "");
    setDeclare(value.declare ?? true); setDurable(value.durable ?? false); setAutoAck(value.autoAck ?? false);
    setReceiveLimit(value.receiveLimit ?? 1); setPayload(value.payload ?? ""); setEncoding(value.encoding ?? "text");
    setContentType(value.contentType ?? "application/octet-stream");
  });

  const build = (): AmqpWorkbenchRequest => ({ name, target, mode, username, passwordRef, exchange, exchangeType, routingKey, queue, declare, durable, autoAck, receiveLimit, payload, encoding, contentType, timeoutMs: 30_000 });
  async function send() { setLoading(true); setMessage(""); setResult(null); try { setResult(await onSend(build(), { onStarted: setExecutionId, onChunk: () => {} })); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setLoading(false); setExecutionId(null); } }
  async function save() { if (!onSave) return; try { await onSave(build()); setMessage("已保存到集合"); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }

  return <ProtocolWorkbenchLayout id="amqp" protocol="AMQP" name={name} target={target} targetLabel="AMQP Broker 地址" actionLabel={mode === "publish" ? "Publish" : "Consume"} loading={loading} result={result} responseTitle={mode === "publish" ? "Publisher confirmation" : "Deliveries"} emptyResponse="AMQP 响应与投递消息会显示在这里" message={message} onNameChange={setName} onTargetChange={setTarget} onRun={() => void send()} onSave={onSave ? () => void save() : undefined} onCancel={onCancel && executionId ? () => void onCancel(executionId) : undefined} controls={<><button role="tab" aria-selected={mode === "publish"} onClick={() => setMode("publish")}>Publish</button><button role="tab" aria-selected={mode === "consume"} onClick={() => setMode("consume")}>Consume</button></>}>
    <ProtocolFormCard>
      <ProtocolFormGrid><ProtocolField label="USERNAME"><TextInput value={username} onChange={(event) => setUsername(event.target.value)}/></ProtocolField><ProtocolField label="PASSWORD SECRET REF"><TextInput value={passwordRef} onChange={(event) => setPasswordRef(event.target.value)}/></ProtocolField><ProtocolField label="EXCHANGE TYPE"><Select value={exchangeType} onChange={(event) => setExchangeType(event.target.value as typeof exchangeType)}>{["direct", "fanout", "topic", "headers"].map((value) => <option key={value}>{value}</option>)}</Select></ProtocolField><ProtocolField label="EXCHANGE"><TextInput value={exchange} onChange={(event) => setExchange(event.target.value)}/></ProtocolField><ProtocolField label="ROUTING KEY"><TextInput value={routingKey} onChange={(event) => setRoutingKey(event.target.value)}/></ProtocolField><ProtocolField label="QUEUE"><TextInput value={queue} onChange={(event) => setQueue(event.target.value)} disabled={mode === "publish"}/></ProtocolField></ProtocolFormGrid>
      {mode === "publish" ? <><ProtocolFormGrid columns={2}><ProtocolField label="CONTENT TYPE"><TextInput value={contentType} onChange={(event) => setContentType(event.target.value)}/></ProtocolField><ProtocolField label="ENCODING"><Select value={encoding} onChange={(event) => setEncoding(event.target.value as typeof encoding)}><option value="text">Text</option><option value="base64">Base64</option></Select></ProtocolField></ProtocolFormGrid><ProtocolField label="MESSAGE"><Textarea className="protocol-code-textarea" value={payload} onChange={(event) => setPayload(event.target.value)}/></ProtocolField></> : <ProtocolField label="MESSAGE LIMIT"><TextInput type="number" min={1} value={receiveLimit} onChange={(event) => setReceiveLimit(Math.max(1, Number(event.target.value)))}/></ProtocolField>}
      <ProtocolFormOptions><Checkbox label="Declare topology" checked={declare} onChange={(event) => setDeclare(event.target.checked)}/><Checkbox label="Durable" checked={durable} onChange={(event) => setDurable(event.target.checked)}/>{mode === "consume" ? <Checkbox label="Auto ACK" checked={autoAck} onChange={(event) => setAutoAck(event.target.checked)}/> : null}</ProtocolFormOptions>
    </ProtocolFormCard>
  </ProtocolWorkbenchLayout>;
}
