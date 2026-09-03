import { useState } from "react";
import type { HttpRunResult, HttpSendHooks } from "./HttpWorkbench";
import { ProtocolWorkbenchLayout } from "./ProtocolWorkbenchLayout";
import { Checkbox, Select, Textarea, TextInput } from "./Components";
import { ProtocolField, ProtocolFormCard, ProtocolFormGrid, ProtocolFormOptions } from "./ProtocolForm";
import { useWorkbenchHydration } from "./useWorkbenchHydration";

export interface MqttWorkbenchRequest {
  name: string; target: string; mode: "publish" | "subscribe"; clientId: string;
  username: string; passwordRef: string; cleanSession: boolean; keepAliveSeconds: number;
  topic: string; payload: string; encoding: "text" | "base64"; qos: 0 | 1 | 2;
  retain: boolean; receiveLimit: number; caPemRef: string; serverName: string; timeoutMs: number;
}
export interface MqttWorkbenchProps {
  onSend: (request: MqttWorkbenchRequest, hooks?: HttpSendHooks) => Promise<HttpRunResult>;
  onSave?: (request: MqttWorkbenchRequest) => Promise<void>;
  onCancel?: (executionId: string) => Promise<void>;
}

export function MqttWorkbench({ onSend, onSave, onCancel }: MqttWorkbenchProps) {
  const [name,setName]=useState("MQTT request"), [target,setTarget]=useState("mqtt://127.0.0.1:1883");
  const [mode,setMode]=useState<"publish"|"subscribe">("publish"), [clientId,setClientId]=useState(`apivoy-${crypto.randomUUID().slice(0,8)}`);
  const [username,setUsername]=useState(""), [passwordRef,setPasswordRef]=useState(""), [cleanSession,setCleanSession]=useState(true), [keepAliveSeconds,setKeepAliveSeconds]=useState(30);
  const [topic,setTopic]=useState("apivoy/demo"), [payload,setPayload]=useState('{"hello":"mqtt"}'), [encoding,setEncoding]=useState<"text"|"base64">("text");
  const [qos,setQos]=useState<0|1|2>(0), [retain,setRetain]=useState(false), [receiveLimit,setReceiveLimit]=useState(1);
  const [caPemRef,setCaPemRef]=useState(""), [serverName,setServerName]=useState("");
  const [result,setResult]=useState<HttpRunResult|null>(null), [message,setMessage]=useState(""), [loading,setLoading]=useState(false), [executionId,setExecutionId]=useState<string|null>(null);

  useWorkbenchHydration("mqtt", (detail) => { const envelope = detail as { protocolId?: string; name?: string; target?: string; payload?: { type?: string; value?: Partial<MqttWorkbenchRequest> } & Partial<MqttWorkbenchRequest> }; if (envelope.protocolId !== "mqtt" || envelope.payload?.type !== "raw") return; const raw = envelope.payload.value ?? envelope.payload; setName(envelope.name ?? ""); setTarget(envelope.target ?? ""); setMode(raw.mode ?? "publish"); setClientId(raw.clientId ?? ""); setUsername(raw.username ?? ""); setPasswordRef(raw.passwordRef ?? ""); setCleanSession(raw.cleanSession ?? true); setKeepAliveSeconds(raw.keepAliveSeconds ?? 30); setTopic(raw.topic ?? ""); setPayload(raw.payload ?? ""); setEncoding(raw.encoding ?? "text"); setQos(raw.qos ?? 0); setRetain(raw.retain ?? false); setReceiveLimit(raw.receiveLimit ?? 1); setCaPemRef(raw.caPemRef ?? ""); setServerName(raw.serverName ?? ""); });
  const build=():MqttWorkbenchRequest=>({name,target,mode,clientId,username,passwordRef,cleanSession,keepAliveSeconds,topic,payload,encoding,qos,retain,receiveLimit,caPemRef,serverName,timeoutMs:30000});
  async function send(){setLoading(true);setResult(null);setMessage("");try{setResult(await onSend(build(),{onStarted:setExecutionId,onChunk:()=>{}}))}catch(error){setMessage(error instanceof Error?error.message:String(error))}finally{setLoading(false);setExecutionId(null)}}
  async function save(){if(!onSave)return;try{await onSave(build());setMessage("已保存到集合")}catch(error){setMessage(error instanceof Error?error.message:String(error))}}
  const tls=target.startsWith("mqtts://");
  return <ProtocolWorkbenchLayout id="mqtt" protocol="MQTT" name={name} target={target} targetLabel="MQTT Broker 地址" actionLabel={mode==="publish"?"Publish":"Subscribe"} loading={loading} result={result} responseTitle={mode==="publish"?"Publish acknowledgement":"Incoming messages"} emptyResponse={mode==="publish"?"发布确认会显示在这里":"订阅消息会实时追加到这里"} message={message} onNameChange={setName} onTargetChange={setTarget} onRun={()=>void send()} onSave={onSave?()=>void save():undefined} onCancel={onCancel&&executionId?()=>void onCancel(executionId):undefined} controls={<><button role="tab" aria-selected={mode==="publish"} onClick={()=>setMode("publish")}>Publish</button><button role="tab" aria-selected={mode==="subscribe"} onClick={()=>setMode("subscribe")}>Subscribe</button></>}>
    <ProtocolFormCard>
      <ProtocolFormGrid><ProtocolField label="CLIENT ID"><TextInput value={clientId} onChange={e=>setClientId(e.target.value)}/></ProtocolField><ProtocolField label="USERNAME"><TextInput value={username} onChange={e=>setUsername(e.target.value)}/></ProtocolField><ProtocolField label="PASSWORD SECRET REF"><TextInput value={passwordRef} onChange={e=>setPasswordRef(e.target.value)} placeholder="mqtt-password"/></ProtocolField></ProtocolFormGrid>
      <ProtocolFormGrid><ProtocolField label="TOPIC"><TextInput value={topic} onChange={e=>setTopic(e.target.value)}/></ProtocolField><ProtocolField label="QoS"><Select value={qos} onChange={e=>setQos(Number(e.target.value) as 0|1|2)}><option value={0}>0 · at most once</option><option value={1}>1 · at least once</option><option value={2}>2 · exactly once</option></Select></ProtocolField>{mode==="subscribe"?<ProtocolField label="MESSAGE LIMIT"><TextInput type="number" min={1} value={receiveLimit} onChange={e=>setReceiveLimit(Math.max(1,Number(e.target.value)))}/></ProtocolField>:<ProtocolField label="ENCODING"><Select value={encoding} onChange={e=>setEncoding(e.target.value as "text"|"base64")}><option value="text">Text</option><option value="base64">Base64</option></Select></ProtocolField>}</ProtocolFormGrid>
      {mode==="publish"&&<ProtocolField label="MESSAGE"><Textarea className="protocol-code-textarea" value={payload} onChange={e=>setPayload(e.target.value)}/></ProtocolField>}
      {tls&&<ProtocolFormGrid columns={2} className="protocol-form-separated"><ProtocolField label="CA PEM SECRET REF"><TextInput value={caPemRef} onChange={e=>setCaPemRef(e.target.value)} placeholder="mqtt-ca-pem"/></ProtocolField><ProtocolField label="SERVER NAME / SNI"><TextInput value={serverName} onChange={e=>setServerName(e.target.value)} placeholder="broker.example.com"/></ProtocolField></ProtocolFormGrid>}
      <ProtocolFormOptions><Checkbox label="Clean session" checked={cleanSession} onChange={e=>setCleanSession(e.target.checked)}/>{mode==="publish"&&<Checkbox label="Retain" checked={retain} onChange={e=>setRetain(e.target.checked)}/>}<label>Keep alive <TextInput className="protocol-number-input" type="number" min={0} max={65535} value={keepAliveSeconds} onChange={e=>setKeepAliveSeconds(Number(e.target.value))}/> s</label></ProtocolFormOptions>
    </ProtocolFormCard>
  </ProtocolWorkbenchLayout>;
}
