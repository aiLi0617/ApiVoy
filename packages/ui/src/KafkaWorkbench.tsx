import { useState } from "react";
import type { HttpRunResult, HttpSendHooks } from "./HttpWorkbench";
import { Checkbox, Select, Textarea, TextInput } from "./Components";
import { ProtocolField, ProtocolFormCard, ProtocolFormGrid, ProtocolFormOptions } from "./ProtocolForm";
import { ProtocolWorkbenchLayout } from "./ProtocolWorkbenchLayout";
import { useWorkbenchHydration } from "./useWorkbenchHydration";

export interface KafkaWorkbenchRequest {
  name: string; target: string; mode: "produce" | "consume"; topic: string; key: string; payload: string;
  encoding: "text" | "base64"; partition: number | null; groupId: string; offsetReset: "earliest" | "latest" | "error";
  autoCommit: boolean; receiveLimit: number; securityProtocol: "PLAINTEXT" | "SSL" | "SASL_PLAINTEXT" | "SASL_SSL";
  saslMechanism: "PLAIN" | "SCRAM-SHA-256" | "SCRAM-SHA-512"; username: string; passwordRef: string;
  caPemRef: string; certificatePemRef: string; keyPemRef: string; keyPasswordRef: string; timeoutMs: number;
}
export interface KafkaWorkbenchProps { onSend: (request: KafkaWorkbenchRequest, hooks?: HttpSendHooks) => Promise<HttpRunResult>; onSave?: (request: KafkaWorkbenchRequest) => Promise<void>; onCancel?: (executionId: string) => Promise<void> }

export function KafkaWorkbench({ onSend, onSave, onCancel }: KafkaWorkbenchProps) {
  const [name, setName] = useState("Kafka request"); const [target, setTarget] = useState("kafka://127.0.0.1:9092");
  const [mode, setMode] = useState<"produce" | "consume">("produce"); const [topic, setTopic] = useState("apivoy-events");
  const [key, setKey] = useState(""); const [payload, setPayload] = useState('{"hello":"kafka"}');
  const [encoding, setEncoding] = useState<"text" | "base64">("text"); const [partition, setPartition] = useState<number | null>(null);
  const [groupId, setGroupId] = useState("apivoy-consumer"); const [offsetReset, setOffsetReset] = useState<KafkaWorkbenchRequest["offsetReset"]>("latest");
  const [autoCommit, setAutoCommit] = useState(false); const [receiveLimit, setReceiveLimit] = useState(1);
  const [securityProtocol, setSecurityProtocol] = useState<KafkaWorkbenchRequest["securityProtocol"]>("PLAINTEXT");
  const [saslMechanism, setSaslMechanism] = useState<KafkaWorkbenchRequest["saslMechanism"]>("PLAIN");
  const [username, setUsername] = useState(""); const [passwordRef, setPasswordRef] = useState(""); const [caPemRef, setCaPemRef] = useState("");
  const [certificatePemRef, setCertificatePemRef] = useState(""); const [keyPemRef, setKeyPemRef] = useState(""); const [keyPasswordRef, setKeyPasswordRef] = useState("");
  const [result, setResult] = useState<HttpRunResult | null>(null); const [message, setMessage] = useState(""); const [loading, setLoading] = useState(false); const [executionId, setExecutionId] = useState<string | null>(null);

  useWorkbenchHydration("kafka", (detail) => {
    const envelope = detail as { protocolId?: string; name?: string; target?: string; payload?: { type?: string; value?: Partial<KafkaWorkbenchRequest> } & Partial<KafkaWorkbenchRequest> };
    if (envelope.protocolId !== "kafka" || envelope.payload?.type !== "raw") return;
    const value = envelope.payload.value ?? envelope.payload;
    setName(envelope.name ?? ""); setTarget(envelope.target ?? ""); setMode(value.mode ?? "produce"); setTopic(value.topic ?? ""); setKey(value.key ?? "");
    setPayload(value.payload ?? ""); setEncoding(value.encoding ?? "text"); setPartition(value.partition ?? null); setGroupId(value.groupId ?? "apivoy-consumer");
    setOffsetReset(value.offsetReset ?? "latest"); setAutoCommit(value.autoCommit ?? false); setReceiveLimit(value.receiveLimit ?? 1);
    setSecurityProtocol(value.securityProtocol ?? "PLAINTEXT"); setSaslMechanism(value.saslMechanism ?? "PLAIN"); setUsername(value.username ?? "");
    setPasswordRef(value.passwordRef ?? ""); setCaPemRef(value.caPemRef ?? ""); setCertificatePemRef(value.certificatePemRef ?? "");
    setKeyPemRef(value.keyPemRef ?? ""); setKeyPasswordRef(value.keyPasswordRef ?? "");
  });

  const build = (): KafkaWorkbenchRequest => ({ name, target, mode, topic, key, payload, encoding, partition, groupId, offsetReset, autoCommit, receiveLimit, securityProtocol, saslMechanism, username, passwordRef, caPemRef, certificatePemRef, keyPemRef, keyPasswordRef, timeoutMs: 30_000 });
  async function run() { setLoading(true); setMessage(""); setResult(null); try { setResult(await onSend(build(), { onStarted: setExecutionId, onChunk: () => {} })); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setLoading(false); setExecutionId(null); } }
  async function save() { if (!onSave) return; try { await onSave(build()); setMessage("已保存到集合"); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }
  const sasl = securityProtocol.includes("SASL"); const tls = securityProtocol.includes("SSL");

  return <ProtocolWorkbenchLayout id="kafka" protocol="KAFKA" name={name} target={target} targetLabel="Kafka Broker 地址" actionLabel={mode === "produce" ? "Produce" : "Consume"} loading={loading} result={result} responseTitle={mode === "produce" ? "Delivery report" : "Consumed records"} emptyResponse="Partition、Offset 与消息内容会显示在这里" message={message} onNameChange={setName} onTargetChange={setTarget} onRun={() => void run()} onSave={onSave ? () => void save() : undefined} onCancel={onCancel && executionId ? () => void onCancel(executionId) : undefined} controls={<><button role="tab" aria-selected={mode === "produce"} onClick={() => setMode("produce")}>Produce</button><button role="tab" aria-selected={mode === "consume"} onClick={() => setMode("consume")}>Consume</button></>}>
    <ProtocolFormCard>
      <ProtocolFormGrid><ProtocolField label="TOPIC"><TextInput value={topic} onChange={(event) => setTopic(event.target.value)}/></ProtocolField>{mode === "produce" ? <><ProtocolField label="MESSAGE KEY"><TextInput value={key} onChange={(event) => setKey(event.target.value)}/></ProtocolField><ProtocolField label="PARTITION"><TextInput type="number" min={-1} value={partition ?? -1} onChange={(event) => setPartition(Number(event.target.value) < 0 ? null : Number(event.target.value))}/></ProtocolField></> : <><ProtocolField label="GROUP ID"><TextInput value={groupId} onChange={(event) => setGroupId(event.target.value)}/></ProtocolField><ProtocolField label="OFFSET RESET"><Select value={offsetReset} onChange={(event) => setOffsetReset(event.target.value as typeof offsetReset)}><option>earliest</option><option>latest</option><option>error</option></Select></ProtocolField></>}</ProtocolFormGrid>
      {mode === "produce" ? <><ProtocolField label="MESSAGE"><Textarea className="protocol-code-textarea" value={payload} onChange={(event) => setPayload(event.target.value)}/></ProtocolField><ProtocolField label="ENCODING"><Select value={encoding} onChange={(event) => setEncoding(event.target.value as typeof encoding)}><option value="text">Text</option><option value="base64">Base64</option></Select></ProtocolField></> : <ProtocolFormGrid columns={2}><ProtocolField label="MESSAGE LIMIT"><TextInput type="number" min={1} value={receiveLimit} onChange={(event) => setReceiveLimit(Math.max(1, Number(event.target.value)))}/></ProtocolField><ProtocolFormOptions><Checkbox label="Auto commit offsets" checked={autoCommit} onChange={(event) => setAutoCommit(event.target.checked)}/></ProtocolFormOptions></ProtocolFormGrid>}
      <details className="protocol-security"><summary>Security</summary><ProtocolFormGrid><ProtocolField label="PROTOCOL"><Select value={securityProtocol} onChange={(event) => setSecurityProtocol(event.target.value as typeof securityProtocol)}>{["PLAINTEXT", "SSL", "SASL_PLAINTEXT", "SASL_SSL"].map((value) => <option key={value}>{value}</option>)}</Select></ProtocolField>{sasl ? <><ProtocolField label="MECHANISM"><Select value={saslMechanism} onChange={(event) => setSaslMechanism(event.target.value as typeof saslMechanism)}><option>PLAIN</option><option>SCRAM-SHA-256</option><option>SCRAM-SHA-512</option></Select></ProtocolField><ProtocolField label="USERNAME"><TextInput value={username} onChange={(event) => setUsername(event.target.value)}/></ProtocolField><ProtocolField label="PASSWORD SECRET REF"><TextInput value={passwordRef} onChange={(event) => setPasswordRef(event.target.value)}/></ProtocolField></> : null}{tls ? <><ProtocolField label="CA PEM SECRET REF"><TextInput value={caPemRef} onChange={(event) => setCaPemRef(event.target.value)}/></ProtocolField><ProtocolField label="CLIENT CERT REF"><TextInput value={certificatePemRef} onChange={(event) => setCertificatePemRef(event.target.value)}/></ProtocolField><ProtocolField label="CLIENT KEY REF"><TextInput value={keyPemRef} onChange={(event) => setKeyPemRef(event.target.value)}/></ProtocolField><ProtocolField label="KEY PASSWORD REF"><TextInput value={keyPasswordRef} onChange={(event) => setKeyPasswordRef(event.target.value)}/></ProtocolField></> : null}</ProtocolFormGrid></details>
    </ProtocolFormCard>
  </ProtocolWorkbenchLayout>;
}
