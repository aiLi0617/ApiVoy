import { AiWorkbench, AmqpWorkbench, AppShell, buildWorkbenchTabs, CaptureWorkbench, CollectionRunner, CommentsWorkbench, exportTeamSnapshot, GatewayWorkbench, GraphqlWorkbench, GrpcWorkbench, HttpWorkbench, KafkaWorkbench, MockWorkbench, MqttWorkbench, PluginCenter, RedisWorkbench, restoreTeamSnapshot, RpcWorkbench, SocketWorkbench, SqlWorkbench, SseWorkbench, SsoWorkbench, TeamWorkbench, WebSocketWorkbench, WorkbenchDeck, WorkspaceExplorer, type AmqpWorkbenchRequest, type HttpWorkbenchRequest, type KafkaWorkbenchRequest, type MqttWorkbenchRequest, type RedisWorkbenchRequest, type RpcWorkbenchRequest, type SqlWorkbenchRequest, type WorkspaceTree } from "@apivoy/ui";
import {
  cancelViaAgent,
  createCollectionViaAgent,
  createProjectViaAgent,
  createWorkspaceViaAgent,
  renameWorkspaceViaAgent,
  archiveWorkspaceViaAgent,
  touchWorkspaceViaAgent,
  deleteWorkspaceViaAgent,
  deleteCollectionViaAgent,
  deleteProjectViaAgent,
  deleteRequestViaAgent,
  executeViaAgent,
  executeEnvelopeViaAgent,
  getEnvironmentViaAgent,
  getHistoryItemViaAgent,
  listHistoryViaAgent,
  getWorkspaceTreeViaAgent,
  loadRequestViaAgent,
  loadEnvelopeViaAgent,
  moveRequestViaAgent,
  renameCollectionViaAgent,
  updateCollectionTagsViaAgent,
  renameProjectViaAgent,
  loadLatestRequestViaAgent,
  putSecretViaAgent,
  saveEnvironmentViaAgent,
  saveRequestViaAgent,
  saveEnvelopeViaAgent,
  agentBaseUrl,
  listMockRulesViaAgent,
  createMockRuleViaAgent,
  deleteMockRuleViaAgent,
  listPluginsViaAgent,
  installPluginViaAgent,
  enablePluginViaAgent,
  deletePluginViaAgent,
  invokePluginViaAgent,
  listCookiesViaAgent,
  setCookieViaAgent,
  deleteCookieViaAgent,
  runAiAssistViaAgent,
  captureStatusViaAgent,
  startCaptureViaAgent,
  stopCaptureViaAgent,
  listCapturesViaAgent,
  clearCapturesViaAgent,
  runCollectionViaAgent,
} from "./agentClient";
import { useEffect, useRef, useState } from "react";
import type { RequestEnvelope } from "@apivoy/request-model";
import { getWorkspaceTreeAbortable } from "./workspaceTreeClient";


export function App() {
  const initialRoute = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const [tree, setTree] = useState<WorkspaceTree | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);
  const refreshSequence = useRef(0);
  const treeAbort = useRef<AbortController | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState(initialRoute.get("project") ?? "default-project");
  const [selectedCollectionId, setSelectedCollectionId] = useState(initialRoute.get("collection") ?? "default-collection");
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(initialRoute.get("request"));
  const rpcEnvelope=(request:RpcWorkbenchRequest):RequestEnvelope=>({id:crypto.randomUUID(),protocolId:request.protocol,name:request.name,target:request.url,environmentRef:"default-env",authRef:null,timeoutMs:request.timeoutMs,retryPolicy:{max_retries:0,backoff_ms:0},proxy:null,tls:{verify:true,client_cert_ref:null},metadata:{},payload:{type:"raw",value:request.protocol==="soap"?{version:request.soapVersion,action:request.action,envelope:request.envelope,headers:request.headers}:{method:request.rpcMethod,params:request.params,id:request.id,headers:request.headers}},preScripts:[],postScripts:[],assertions:[],variables:{},createdAt:new Date().toISOString()});
  const redisEnvelope=(request:RedisWorkbenchRequest):RequestEnvelope=>({id:crypto.randomUUID(),protocolId:"redis",name:request.name,target:request.target,environmentRef:"default-env",authRef:null,timeoutMs:request.timeoutMs,retryPolicy:{max_retries:0,backoff_ms:0},proxy:null,tls:{verify:true,client_cert_ref:null},metadata:{},payload:{type:"raw",value:{username:request.username,passwordRef:request.passwordRef,database:request.database,commands:request.commands}},preScripts:[],postScripts:[],assertions:[],variables:{},createdAt:new Date().toISOString()});
  const mqttEnvelope=(request:MqttWorkbenchRequest):RequestEnvelope=>({id:crypto.randomUUID(),protocolId:"mqtt",name:request.name,target:request.target,environmentRef:"default-env",authRef:null,timeoutMs:request.timeoutMs,retryPolicy:{max_retries:0,backoff_ms:0},proxy:null,tls:{verify:true,client_cert_ref:null},metadata:{},payload:{type:"raw",value:{mode:request.mode,clientId:request.clientId,username:request.username,passwordRef:request.passwordRef,cleanSession:request.cleanSession,keepAliveSeconds:request.keepAliveSeconds,topic:request.topic,payload:request.payload,encoding:request.encoding,qos:request.qos,retain:request.retain,receiveLimit:request.receiveLimit,caPemRef:request.caPemRef,serverName:request.serverName}},preScripts:[],postScripts:[],assertions:[],variables:{},createdAt:new Date().toISOString()});
  const amqpEnvelope=(request:AmqpWorkbenchRequest):RequestEnvelope=>({id:crypto.randomUUID(),protocolId:"amqp",name:request.name,target:request.target,environmentRef:"default-env",authRef:null,timeoutMs:request.timeoutMs,retryPolicy:{max_retries:0,backoff_ms:0},proxy:null,tls:{verify:true,client_cert_ref:null},metadata:{},payload:{type:"raw",value:{mode:request.mode,username:request.username,passwordRef:request.passwordRef,exchange:request.exchange,exchangeType:request.exchangeType,routingKey:request.routingKey,queue:request.queue,declare:request.declare,durable:request.durable,autoAck:request.autoAck,receiveLimit:request.receiveLimit,payload:request.payload,encoding:request.encoding,contentType:request.contentType}},preScripts:[],postScripts:[],assertions:[],variables:{},createdAt:new Date().toISOString()});
  const kafkaEnvelope=(request:KafkaWorkbenchRequest):RequestEnvelope=>({id:crypto.randomUUID(),protocolId:"kafka",name:request.name,target:request.target,environmentRef:"default-env",authRef:null,timeoutMs:request.timeoutMs,retryPolicy:{max_retries:0,backoff_ms:0},proxy:null,tls:{verify:true,client_cert_ref:null},metadata:{},payload:{type:"raw",value:{mode:request.mode,topic:request.topic,key:request.key,payload:request.payload,encoding:request.encoding,partition:request.partition,groupId:request.groupId,offsetReset:request.offsetReset,autoCommit:request.autoCommit,receiveLimit:request.receiveLimit,securityProtocol:request.securityProtocol,saslMechanism:request.saslMechanism,username:request.username,passwordRef:request.passwordRef,caPemRef:request.caPemRef,certificatePemRef:request.certificatePemRef,keyPemRef:request.keyPemRef,keyPasswordRef:request.keyPasswordRef}},preScripts:[],postScripts:[],assertions:[],variables:{},createdAt:new Date().toISOString()});
  const sqlEnvelope=(request:SqlWorkbenchRequest):RequestEnvelope=>({id:crypto.randomUUID(),protocolId:"sql",name:request.name,target:request.target,environmentRef:"default-env",authRef:null,timeoutMs:request.timeoutMs,retryPolicy:{max_retries:0,backoff_ms:0},proxy:null,tls:{verify:true,client_cert_ref:null},metadata:{},payload:{type:"raw",value:{username:request.username,passwordRef:request.passwordRef,sql:request.sql,parameters:request.parameters,transactional:request.transactional,rowLimit:request.rowLimit}},preScripts:[],postScripts:[],assertions:[],variables:{},createdAt:new Date().toISOString()});
  const [externalRequest, setExternalRequest] = useState<HttpWorkbenchRequest | null>(null);

  async function refreshTree() {
    const sequence = ++refreshSequence.current;
    treeAbort.current?.abort("superseded");
    const controller = new AbortController(); treeAbort.current = controller;
    const timer = window.setTimeout(() => controller.abort("timeout"), 10000);
    setTreeLoading(true); setTreeError(null);
    try {
      const nextTree = await getWorkspaceTreeAbortable(controller.signal);
      if (sequence === refreshSequence.current) setTree(nextTree);
    } catch (error) {
      if (sequence !== refreshSequence.current) return;
      const message = controller.signal.aborted && controller.signal.reason === "timeout" ? "连接 Local Agent 超时（10 秒）" : error instanceof Error ? error.message : String(error);
      setTreeError(/401|unauthorized|session exchange/i.test(message) ? "Local Agent 在线，但尚未完成配对。请在设置中填写 Agent Token 后刷新页面。" : message);
    } finally { window.clearTimeout(timer); if (sequence === refreshSequence.current) setTreeLoading(false); }
  }
  useEffect(() => { void refreshTree(); }, []);
  useEffect(() => () => treeAbort.current?.abort("unmount"), []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    params.set("project", selectedProjectId); params.set("collection", selectedCollectionId);
    if (selectedRequestId) params.set("request", selectedRequestId); else params.delete("request");
    history.replaceState(null, "", `#${params}`);
  }, [selectedProjectId, selectedCollectionId, selectedRequestId]);

  return (
    <AppShell
      channelLabel="Web → Local Agent"
      connectionStatus={treeLoading ? { label: "正在连接 Local Agent", tone: "warn" } : treeError ? { label: "Local Agent 连接异常", tone: "off" } : { label: "Local Agent 已连接", tone: "ok" }}
      environment={{
        onLoad: getEnvironmentViaAgent,
        onSave: async (variables, secretRefs) => { await saveEnvironmentViaAgent(variables, secretRefs); },
      }}
      collaboration={{
        team: <TeamWorkbench onExportSnapshot={async () => exportTeamSnapshot(await getWorkspaceTreeViaAgent(), loadEnvelopeViaAgent)} onRestoreSnapshot={async (snapshot) => { await restoreTeamSnapshot(snapshot, { getTree: getWorkspaceTreeViaAgent, createWorkspace: createWorkspaceViaAgent, createProject: createProjectViaAgent, createCollection: createCollectionViaAgent, saveEnvelope: saveEnvelopeViaAgent }); await refreshTree(); }} />,
        comments: <CommentsWorkbench contextCollectionId={selectedCollectionId} contextRequestId={selectedRequestId} contextLabel={selectedRequestId ? `请求 ${selectedRequestId}` : selectedCollectionId ? `集合 ${selectedCollectionId}` : null} />,
        sso: <SsoWorkbench />,
      }}
      explorer={<WorkspaceExplorer tree={tree} loading={treeLoading} error={treeError} onRetry={() => void refreshTree()} selectedCollectionId={selectedCollectionId} selectedRequestId={selectedRequestId}
      onSelectCollection={(projectId, collectionId) => { setSelectedProjectId(projectId); setSelectedCollectionId(collectionId); }}
      onOpenRequest={async (id) => { setSelectedRequestId(id); const envelope = await loadEnvelopeViaAgent(id); if (envelope) window.dispatchEvent(new CustomEvent("apivoy-open-request", { detail: envelope })); setExternalRequest(envelope?.payload.type === "http" ? await loadRequestViaAgent(id) : null); }}
      onCreateWorkspace={async (name) => { await createWorkspaceViaAgent(name); await refreshTree(); }}
      onRenameWorkspace={async (id, name) => { await renameWorkspaceViaAgent(id, name); await refreshTree(); }}
      onArchiveWorkspace={async (id, archived) => { await archiveWorkspaceViaAgent(id, archived); await refreshTree(); }}
      onTouchWorkspace={async (id) => { await touchWorkspaceViaAgent(id); await refreshTree(); }}
      onDeleteWorkspace={async (id) => { await deleteWorkspaceViaAgent(id); await refreshTree(); }}
      onCreateProject={async (workspaceId, name) => { await createProjectViaAgent(workspaceId, name); await refreshTree(); }}
      onRenameProject={async (id, name) => { await renameProjectViaAgent(id, name); await refreshTree(); }}
      onDeleteProject={async (id) => { await deleteProjectViaAgent(id); await refreshTree(); }}
      onCreateCollection={async (projectId, parentId, name) => { await createCollectionViaAgent(projectId, parentId, name); await refreshTree(); }}
      onRenameCollection={async (collection, name) => { await renameCollectionViaAgent(collection.id, name, collection.parentId ?? null, collection.sortOrder); await refreshTree(); }}
      onUpdateCollectionTags={async (collection, tags) => { await updateCollectionTagsViaAgent(collection.id, tags); await refreshTree(); }}
      onDeleteCollection={async (id) => { await deleteCollectionViaAgent(id); await refreshTree(); }}
      onMoveCollection={async (collection, projectId, parentId) => { if (projectId !== collection.projectId) throw new Error("暂不支持跨项目移动集合"); await renameCollectionViaAgent(collection.id, collection.name, parentId, collection.sortOrder); await refreshTree(); }}
      onSwapCollections={async (first, second) => { await renameCollectionViaAgent(first.id, first.name, first.parentId ?? null, second.sortOrder); await renameCollectionViaAgent(second.id, second.name, second.parentId ?? null, first.sortOrder); await refreshTree(); }}
      onMoveRequest={async (id, projectId, collectionId) => { await moveRequestViaAgent(id, projectId, collectionId); await refreshTree(); }}
      onImportRequests={async (projectId, collectionId, requests) => { const paths = new Map<string, string>(); for (const request of requests) { let parentId = collectionId; let key = collectionId; for (const segment of request.collectionPath ?? []) { key += `/${segment}`; let id = paths.get(key); if (!id) { const existing = tree?.collections.find((item) => item.projectId === projectId && (item.parentId ?? null) === parentId && item.name === segment); const created = existing ?? await createCollectionViaAgent(projectId, parentId, segment); id = created.id; paths.set(key, id); } parentId = id; } await saveRequestViaAgent({ name: request.name, url: request.url, method: request.method, headers: Object.entries(request.headers), body: request.body, timeoutMs: 30000, variables: request.variables ?? {}, assertions: [], auth: null, followRedirects: true, retryMax: 0, retryBackoffMs: 250, proxy: null, tlsVerify: true }, projectId, parentId); } await refreshTree(); }}
      onExportProject={async (project) => { const items = tree?.requests.filter((item) => item.projectId === project.id) ?? []; return Promise.all(items.map(async (item) => { const request = await loadRequestViaAgent(item.id); return { name: item.name, method: request?.method ?? item.method ?? "GET", url: request?.url ?? item.target, headers: Object.fromEntries(request?.headers ?? []), body: request?.body }; })); }}
      onDeleteRequest={async (id) => { await deleteRequestViaAgent(id); if (selectedRequestId === id) setSelectedRequestId(null); await refreshTree(); }}
      onRunCollection={(projectId, collectionId) => { setSelectedProjectId(projectId); setSelectedCollectionId(collectionId); }}
    />}>
      <WorkbenchDeck tabs={buildWorkbenchTabs({ runner: true })} saveTargetLabel={`${selectedProjectId} / ${selectedCollectionId}`}>
      <HttpWorkbench
        externalRequest={externalRequest}
        onSend={executeViaAgent}
        onCancel={cancelViaAgent}
        onPutSecret={putSecretViaAgent}
        onListCookies={listCookiesViaAgent}
        onSetCookie={setCookieViaAgent}
        onDeleteCookie={deleteCookieViaAgent}
        onSave={async (request) => { await saveRequestViaAgent(request, selectedProjectId, selectedCollectionId); await refreshTree(); }}
        onLoad={loadLatestRequestViaAgent}
        onLoadEnvironment={getEnvironmentViaAgent}
        onSaveEnvironment={saveEnvironmentViaAgent}
        onListHistory={listHistoryViaAgent}
        onReplayHistory={getHistoryItemViaAgent}
      />
      <SseWorkbench onConnect={(request, hooks) => executeEnvelopeViaAgent({ id: crypto.randomUUID(), protocolId: "sse", name: request.name, target: request.url, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "sse", headers: request.headers, lastEventId: request.lastEventId ?? null, reconnectMax: request.reconnectMax, reconnectDelayMs: request.reconnectDelayMs }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }, hooks)} onSave={async (request) => { await saveEnvelopeViaAgent({ id: crypto.randomUUID(), protocolId: "sse", name: request.name, target: request.url, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "sse", headers: request.headers, lastEventId: request.lastEventId ?? null, reconnectMax: request.reconnectMax, reconnectDelayMs: request.reconnectDelayMs }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }, selectedProjectId, selectedCollectionId); await refreshTree(); }} onCancel={cancelViaAgent} />
      <SocketWorkbench onSend={(request, hooks) => executeEnvelopeViaAgent({ id: crypto.randomUUID(), protocolId: request.protocol, name: request.name, target: request.target, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: request.protocol === "tcp" ? { type: "tcp", data: request.data, encoding: request.encoding, framing: request.framing, delimiter: request.delimiter, fixedLength: request.fixedLength, sendCount: request.sendCount, intervalMs: request.intervalMs, tls: request.tls, serverName: request.serverName, caCertRef: request.caCertRef } : { type: "udp", data: request.data, encoding: request.encoding, sendCount: request.sendCount, intervalMs: request.intervalMs }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }, hooks)} onSave={async (request) => { await saveEnvelopeViaAgent({ id: crypto.randomUUID(), protocolId: request.protocol, name: request.name, target: request.target, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: request.protocol === "tcp" ? { type: "tcp", data: request.data, encoding: request.encoding, framing: request.framing, delimiter: request.delimiter, fixedLength: request.fixedLength, sendCount: request.sendCount, intervalMs: request.intervalMs, tls: request.tls, serverName: request.serverName, caCertRef: request.caCertRef } : { type: "udp", data: request.data, encoding: request.encoding, sendCount: request.sendCount, intervalMs: request.intervalMs }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }, selectedProjectId, selectedCollectionId); await refreshTree(); }} onCancel={cancelViaAgent} />
      <GraphqlWorkbench onSend={(request, hooks) => executeEnvelopeViaAgent({ id: crypto.randomUUID(), protocolId: "graphql", name: request.name, target: request.url, environmentRef: "default-env", authRef: null, timeoutMs: 30000, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "graphql", query: request.query, variables: request.variables, operationName: request.operationName ?? null, headers: request.headers }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }, hooks)} onSave={async (request) => { await saveEnvelopeViaAgent({ id: crypto.randomUUID(), protocolId: "graphql", name: request.name, target: request.url, environmentRef: "default-env", authRef: null, timeoutMs: 30000, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "graphql", query: request.query, variables: request.variables, operationName: request.operationName ?? null, headers: request.headers }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }, selectedProjectId, selectedCollectionId); await refreshTree(); }} onCancel={cancelViaAgent} />
      <WebSocketWorkbench onConnect={(request, hooks) => executeEnvelopeViaAgent({ id: crypto.randomUUID(), protocolId: "websocket", name: request.name, target: request.url, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "websocket", headers: request.headers, subprotocols: request.subprotocols, messages: request.messages, receiveLimit: request.receiveLimit, reconnectMax: request.reconnectMax, reconnectDelayMs: request.reconnectDelayMs }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }, hooks)} onSave={async (request) => { await saveEnvelopeViaAgent({ id: crypto.randomUUID(), protocolId: "websocket", name: request.name, target: request.url, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "websocket", headers: request.headers, subprotocols: request.subprotocols, messages: request.messages, receiveLimit: request.receiveLimit, reconnectMax: request.reconnectMax, reconnectDelayMs: request.reconnectDelayMs }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }, selectedProjectId, selectedCollectionId); await refreshTree(); }} onCancel={cancelViaAgent} />
      <GrpcWorkbench onSend={(request, hooks) => executeEnvelopeViaAgent({ id: crypto.randomUUID(), protocolId: "grpc", name: request.name, target: request.target, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "grpc", service: request.service, method: request.method, messageBase64: request.messageBase64, messageJson: request.messageJson, descriptorSetBase64: request.descriptorSetBase64, mode: request.mode, metadata: request.metadata }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }, hooks)} onSave={async (request) => { await saveEnvelopeViaAgent({ id: crypto.randomUUID(), protocolId: "grpc", name: request.name, target: request.target, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "grpc", service: request.service, method: request.method, messageBase64: request.messageBase64, messageJson: request.messageJson, descriptorSetBase64: request.descriptorSetBase64, mode: request.mode, metadata: request.metadata }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }, selectedProjectId, selectedCollectionId); await refreshTree(); }} onCancel={cancelViaAgent} />
      <RpcWorkbench onSend={(request,hooks)=>executeEnvelopeViaAgent(rpcEnvelope(request),hooks)} onSave={async(request)=>{await saveEnvelopeViaAgent(rpcEnvelope(request),selectedProjectId,selectedCollectionId);await refreshTree();}} onCancel={cancelViaAgent} />
      <RedisWorkbench onSend={(request,hooks)=>executeEnvelopeViaAgent(redisEnvelope(request),hooks)} onSave={async(request)=>{await saveEnvelopeViaAgent(redisEnvelope(request),selectedProjectId,selectedCollectionId);await refreshTree();}} onCancel={cancelViaAgent} />
      <MqttWorkbench onSend={(request,hooks)=>executeEnvelopeViaAgent(mqttEnvelope(request),hooks)} onSave={async(request)=>{await saveEnvelopeViaAgent(mqttEnvelope(request),selectedProjectId,selectedCollectionId);await refreshTree();}} onCancel={cancelViaAgent} />
      <AmqpWorkbench onSend={(request,hooks)=>executeEnvelopeViaAgent(amqpEnvelope(request),hooks)} onSave={async(request)=>{await saveEnvelopeViaAgent(amqpEnvelope(request),selectedProjectId,selectedCollectionId);await refreshTree();}} onCancel={cancelViaAgent} />
      <KafkaWorkbench onSend={(request,hooks)=>executeEnvelopeViaAgent(kafkaEnvelope(request),hooks)} onSave={async(request)=>{await saveEnvelopeViaAgent(kafkaEnvelope(request),selectedProjectId,selectedCollectionId);await refreshTree();}} onCancel={cancelViaAgent} />
      <SqlWorkbench onSend={(request,hooks)=>executeEnvelopeViaAgent(sqlEnvelope(request),hooks)} onSave={async(request)=>{await saveEnvelopeViaAgent(sqlEnvelope(request),selectedProjectId,selectedCollectionId);await refreshTree();}} onCancel={cancelViaAgent} />
      <MockWorkbench baseUrl={agentBaseUrl} onList={listMockRulesViaAgent} onCreate={createMockRuleViaAgent} onDelete={deleteMockRuleViaAgent} />
      <CollectionRunner collectionId={selectedCollectionId} onRun={(collectionId, failFast) => runCollectionViaAgent(collectionId, failFast)} />
      <GatewayWorkbench />
      <CaptureWorkbench onStatus={captureStatusViaAgent} onStart={startCaptureViaAgent} onStop={stopCaptureViaAgent} onList={listCapturesViaAgent} onClear={clearCapturesViaAgent} />
      <PluginCenter onList={listPluginsViaAgent} onInstall={installPluginViaAgent} onEnable={enablePluginViaAgent} onDelete={deletePluginViaAgent} onInvoke={invokePluginViaAgent} />
      <AiWorkbench onAssist={runAiAssistViaAgent} onPutSecret={putSecretViaAgent} />
      </WorkbenchDeck>
    </AppShell>
  );
}
