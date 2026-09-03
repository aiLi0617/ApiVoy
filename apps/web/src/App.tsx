import { amqpRequestEnvelope, kafkaRequestEnvelope, mqttRequestEnvelope, redisRequestEnvelope, sqlRequestEnvelope } from "@apivoy/ui";
import { AiWorkbench, AmqpWorkbench, AppShell, buildWorkbenchTabs, CaptureWorkbench, CommentsWorkbench, exportTeamSnapshot, GatewayWorkbench, GrpcWorkbench, HttpWorkbench, KafkaWorkbench, MockWorkbench, MqttWorkbench, PluginCenter, RedisWorkbench, restoreTeamSnapshot, TcpWorkbench, UdpWorkbench, SqlWorkbench, SseWorkbench, SsoWorkbench, TeamWorkbench, WebSocketWorkbench, WorkbenchDeck, WorkspaceExplorer, type WorkspaceTree } from "@apivoy/ui";
import {
  cancelViaAgent,
  createCollectionViaAgent,
  createModuleViaAgent,
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
  tcpSessionConnectionViaAgent,
} from "./agentClient";
import { useEffect, useRef, useState } from "react";
import { getWorkspaceTreeAbortable } from "./workspaceTreeClient";


function requestIdentity(request: unknown): string { return (request as { id?: string }).id ?? crypto.randomUUID(); }

export function App() {
  const initialRoute = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const [tree, setTree] = useState<WorkspaceTree | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);
  const refreshSequence = useRef(0);
  const treeAbort = useRef<AbortController | null>(null);
  const initialRequestToRestore = useRef(initialRoute.get("request"));
  const [selectedProjectId, setSelectedProjectId] = useState(initialRoute.get("project") ?? "default-project");
  const [selectedCollectionId, setSelectedCollectionId] = useState(initialRoute.get("collection") ?? "default-collection");
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(initialRoute.get("request"));
  useEffect(() => {
    const reset = () => { setSelectedRequestId(null); };
    window.addEventListener("apivoy-new-workbench", reset);
    return () => window.removeEventListener("apivoy-new-workbench", reset);
  }, []);

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
  async function cloneProject(projectId: string, name: string) {
    if (!tree) throw new Error("项目数据尚未加载完成");
    const source = tree.projects.find((project) => project.id === projectId);
    if (!source) throw new Error("未找到要克隆的项目");
    const created = await createProjectViaAgent(source.workspaceId, name);
    const collectionIds = new Map<string, string>();
    const pending = tree.collections.filter((collection) => collection.projectId === projectId);
    while (pending.length) {
      const index = pending.findIndex((collection) => !collection.parentId || collectionIds.has(collection.parentId));
      if (index < 0) throw new Error("项目集合层级存在循环，无法克隆");
      const collection = pending.splice(index, 1)[0];
      const copy = await createCollectionViaAgent(created.id, collection.parentId ? collectionIds.get(collection.parentId) ?? null : null, collection.name);
      collectionIds.set(collection.id, copy.id);
    }
    for (const request of tree.requests.filter((item) => item.projectId === projectId)) {
      const collectionId = collectionIds.get(request.collectionId);
      if (!collectionId) continue;
      const envelope = await loadEnvelopeViaAgent(request.id);
      if (envelope) await saveEnvelopeViaAgent({ ...envelope, id: crypto.randomUUID(), createdAt: new Date().toISOString() }, created.id, collectionId);
    }
    setSelectedProjectId(created.id); setSelectedCollectionId(collectionIds.values().next().value ?? ""); setSelectedRequestId(null);
    await refreshTree();
  }
  useEffect(() => { void refreshTree(); }, []);
  useEffect(() => {
    const deleteTestCase = async (event: Event) => { const id = (event as CustomEvent<{ caseId?: string }>).detail?.caseId; if (!id) return; await deleteRequestViaAgent(id); await refreshTree(); };
    window.addEventListener("apivoy-delete-test-case", deleteTestCase);
    return () => window.removeEventListener("apivoy-delete-test-case", deleteTestCase);
  }, []);
  useEffect(() => () => treeAbort.current?.abort("unmount"), []);
  useEffect(() => {
    const id = initialRequestToRestore.current;
    if (!tree || !id) return;
    initialRequestToRestore.current = null;
    void loadEnvelopeViaAgent(id).then((envelope) => { if (envelope) window.dispatchEvent(new CustomEvent("apivoy-open-request", { detail: envelope })); });
  }, [tree]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    params.set("project", selectedProjectId); params.set("collection", selectedCollectionId);
    if (selectedRequestId) params.set("request", selectedRequestId); else params.delete("request");
    history.replaceState(null, "", `#${params}`);
  }, [selectedProjectId, selectedCollectionId, selectedRequestId]);

  return (
    <AppShell
      channelLabel="Web → Local Agent"
      projectContext={{ projects: tree?.projects ?? [], selectedProjectId, onSelectProject: (projectId) => { setSelectedProjectId(projectId); setSelectedCollectionId(tree?.collections.find((item) => item.projectId === projectId)?.id ?? ""); setSelectedRequestId(null); } }}
      requestHistory={{ onList: listHistoryViaAgent, onReplay: getHistoryItemViaAgent, requestEditor: { onSend: executeViaAgent, onSendEnvelope: executeEnvelopeViaAgent, onCancel: cancelViaAgent, onPutSecret: putSecretViaAgent, onListCookies: listCookiesViaAgent, onSetCookie: setCookieViaAgent, onDeleteCookie: deleteCookieViaAgent, onSaveInterface: async (request, collectionId) => { await saveRequestViaAgent(request, selectedProjectId, collectionId); await refreshTree(); }, onSaveEnvelopeInterface: async (request, collectionId) => { await saveEnvelopeViaAgent(request, selectedProjectId, collectionId); await refreshTree(); }, onSaveDebugCase: async (request, parent) => { await saveRequestViaAgent(request, parent.projectId, parent.collectionId); await refreshTree(); }, onSaveEnvelopeDebugCase: async (request, parent) => { await saveEnvelopeViaAgent(request, parent.projectId, parent.collectionId); await refreshTree(); }, onOpenInterface: async (id) => { const record = tree?.requests.find((request) => request.id === id); if (record) { setSelectedProjectId(record.projectId); setSelectedCollectionId(record.collectionId); setSelectedRequestId(id); } const envelope = await loadEnvelopeViaAgent(id); if (envelope) window.dispatchEvent(new CustomEvent("apivoy-open-request", { detail: envelope })); }, interfaces: (tree?.requests ?? []).filter((request) => !request.envelope?.variables?.__apivoyCaseOf).map((request) => ({ id: request.id, name: request.name, projectId: request.projectId, collectionId: request.collectionId, method: request.method, protocolId: request.protocolId, target: request.target })), saveCollections: (tree?.collections ?? []).filter((collection) => collection.projectId === selectedProjectId), saveModules: tree?.modules ?? [], defaultSaveCollectionId: selectedCollectionId } }}
      connectionStatus={treeLoading ? { label: "正在连接 Local Agent", tone: "warn" } : treeError ? { label: "Local Agent 连接异常", tone: "off" } : { label: "Local Agent 已连接", tone: "ok" }}
      environment={{
        onLoad: getEnvironmentViaAgent,
        onSave: async (variables, secretRefs) => { await saveEnvironmentViaAgent(variables, secretRefs); },
        onPutSecret: putSecretViaAgent,
      }}
      collaboration={{
        team: <TeamWorkbench onExportSnapshot={async () => exportTeamSnapshot(await getWorkspaceTreeViaAgent(), loadEnvelopeViaAgent)} onRestoreSnapshot={async (snapshot) => { await restoreTeamSnapshot(snapshot, { getTree: getWorkspaceTreeViaAgent, createWorkspace: createWorkspaceViaAgent, createProject: createProjectViaAgent, createCollection: createCollectionViaAgent, saveEnvelope: saveEnvelopeViaAgent }); await refreshTree(); }} />,
        comments: <CommentsWorkbench contextCollectionId={selectedCollectionId} contextRequestId={selectedRequestId} contextLabel={selectedRequestId ? `请求 ${selectedRequestId}` : selectedCollectionId ? `集合 ${selectedCollectionId}` : null} />,
        sso: <SsoWorkbench />,
      }}
      explorer={<WorkspaceExplorer tree={tree} loading={treeLoading} error={treeError} onRetry={() => void refreshTree()} selectedProjectId={selectedProjectId} selectedCollectionId={selectedCollectionId} selectedRequestId={selectedRequestId}
      onSelectCollection={(projectId, collectionId) => { setSelectedProjectId(projectId); setSelectedCollectionId(collectionId); }}
      onOpenRequest={async (id) => { setSelectedRequestId(id); const envelope = await loadEnvelopeViaAgent(id); if (!envelope) return; const parentId = envelope.variables?.__apivoyCaseOf; const parent = parentId ? await loadEnvelopeViaAgent(parentId) : null; const detail = parent ? { ...envelope, metadata: { ...(envelope.metadata ?? {}), __apivoyCaseInterfaceName: parent.name } } : envelope; window.dispatchEvent(new CustomEvent("apivoy-open-request", { detail })); }}
      onCreateWorkspace={async (name) => { await createWorkspaceViaAgent(name); await refreshTree(); }}
      onRenameWorkspace={async (id, name) => { await renameWorkspaceViaAgent(id, name); await refreshTree(); }}
      onArchiveWorkspace={async (id, archived) => { await archiveWorkspaceViaAgent(id, archived); await refreshTree(); }}
      onTouchWorkspace={async (id) => { await touchWorkspaceViaAgent(id); await refreshTree(); }}
      onDeleteWorkspace={async (id) => { await deleteWorkspaceViaAgent(id); await refreshTree(); }}
      onCreateProject={async (workspaceId, name) => { await createProjectViaAgent(workspaceId, name); await refreshTree(); }}
      onCreateModule={async (projectId, name) => { await createModuleViaAgent(projectId, name); await refreshTree(); }}
      onRenameProject={async (id, name) => { await renameProjectViaAgent(id, name); await refreshTree(); }}
      onDeleteProject={async (id) => { await deleteProjectViaAgent(id); await refreshTree(); }}
      onCreateCollection={async (projectId, parentId, name, moduleId) => { await createCollectionViaAgent(projectId, parentId, name, moduleId); await refreshTree(); }}
      onRenameCollection={async (collection, name) => { await renameCollectionViaAgent(collection.id, name, collection.parentId ?? null, collection.sortOrder); await refreshTree(); }}
      onUpdateCollectionTags={async (collection, tags) => { await updateCollectionTagsViaAgent(collection.id, tags); await refreshTree(); }}
      onDeleteCollection={async (id) => { await deleteCollectionViaAgent(id); await refreshTree(); }}
      onMoveCollection={async (collection, projectId, parentId) => { if (projectId !== collection.projectId) throw new Error("暂不支持跨项目移动集合"); await renameCollectionViaAgent(collection.id, collection.name, parentId, collection.sortOrder); await refreshTree(); }}
      onSwapCollections={async (first, second) => { await renameCollectionViaAgent(first.id, first.name, first.parentId ?? null, second.sortOrder); await renameCollectionViaAgent(second.id, second.name, second.parentId ?? null, first.sortOrder); await refreshTree(); }}
      onMoveRequest={async (id, projectId, collectionId) => { await moveRequestViaAgent(id, projectId, collectionId); await refreshTree(); }}
      onImportRequests={async (projectId, collectionId, requests) => { const paths = new Map<string, string>(); for (const request of requests) { let parentId = collectionId; let key = collectionId; for (const segment of request.collectionPath ?? []) { key += `/${segment}`; let id = paths.get(key); if (!id) { const existing = tree?.collections.find((item) => item.projectId === projectId && (item.parentId ?? null) === parentId && item.name === segment); const created = existing ?? await createCollectionViaAgent(projectId, parentId, segment); id = created.id; paths.set(key, id); } parentId = id; } await saveRequestViaAgent({ name: request.name, url: request.url, method: request.method, headers: Object.entries(request.headers), body: request.body, timeoutMs: 30000, variables: request.variables ?? {}, assertions: [], auth: null, followRedirects: true, retryMax: 0, retryBackoffMs: 250, proxy: null, tlsVerify: true }, projectId, parentId); } await refreshTree(); }}
      onExportProject={async (project) => { const items = tree?.requests.filter((item) => item.projectId === project.id) ?? []; return Promise.all(items.map(async (item) => { const request = await loadRequestViaAgent(item.id); return { name: item.name, method: request?.method ?? item.method ?? "GET", url: request?.url ?? item.target, headers: Object.fromEntries(request?.headers ?? []), body: request?.body }; })); }}
      onDeleteRequest={async (id) => { await deleteRequestViaAgent(id); window.dispatchEvent(new CustomEvent("apivoy-request-deleted", { detail: { requestId: id } })); if (selectedRequestId === id) setSelectedRequestId(null); await refreshTree(); }}
      onRenameRequest={async (request, name) => { const envelope = await loadEnvelopeViaAgent(request.id); if (!envelope) return; await saveEnvelopeViaAgent({ ...envelope, name }, request.projectId, request.collectionId); await refreshTree(); }}
      onDuplicateRequest={async (request) => { const envelope = await loadEnvelopeViaAgent(request.id); if (!envelope) return; await saveEnvelopeViaAgent({ ...envelope, id: crypto.randomUUID(), name: `${envelope.name} 副本`, createdAt: new Date().toISOString() }, request.projectId, request.collectionId); await refreshTree(); }}
      onCopyRequestAsCurl={async (request) => { const saved = await loadRequestViaAgent(request.id); const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`; if (!saved) return `curl --location --request ${request.method ?? "GET"} ${quote(request.target)}`; return [`curl --location --request ${saved.method} ${quote(saved.url)}`, ...saved.headers.map(([key, value]) => `  --header ${quote(`${key}: ${value}`)}`), ...(saved.body ? [`  --data-raw ${quote(saved.body)}`] : [])].join(" \\\n"); }}
    />}>
      <WorkbenchDeck saveCollections={tree?.collections ?? []} saveModules={tree?.modules ?? []} onCreateSaveCollection={async (projectId, parentId, name, moduleId) => { const created = await createCollectionViaAgent(projectId, parentId, name, moduleId); await refreshTree(); return created; }} interfaceCases={(tree?.requests ?? []).filter((request) => request.envelope?.variables?.__apivoyCaseOf).map((request) => ({ id: request.id, parentId: request.envelope!.variables!.__apivoyCaseOf, name: request.name, method: request.method, target: request.target, metadata: request.envelope?.metadata }))} onLoadHttpInterface={loadRequestViaAgent} onCreateHttpInterface={async (request, projectId, collectionId) => { await saveRequestViaAgent(request, projectId || selectedProjectId, collectionId || selectedCollectionId); await refreshTree(); }} tabs={buildWorkbenchTabs({ runner: false })} projects={(tree?.projects ?? []).map((project) => { const requests = tree?.requests.filter((request) => request.projectId === project.id) ?? []; return { id: project.id, name: project.name, resourceCount: requests.length, protocols: Array.from(new Set(requests.map((request) => request.protocolId ?? request.method ?? "http"))) }; })} selectedProjectId={selectedProjectId} onSelectProject={(projectId) => { setSelectedProjectId(projectId); setSelectedCollectionId(tree?.collections.find((item) => item.projectId === projectId)?.id ?? ""); setSelectedRequestId(null); }} onCreateProject={async (name) => { const created = await createProjectViaAgent(tree?.workspaces[0]?.id ?? "default-workspace", name); setSelectedProjectId(created.id); setSelectedCollectionId(""); await refreshTree(); }} onRenameProject={async (id, name) => { await renameProjectViaAgent(id, name); await refreshTree(); }} onCloneProject={cloneProject} onDeleteProject={async (id) => { await deleteProjectViaAgent(id); if (selectedProjectId === id) { const fallback = tree?.projects.find((project) => project.id !== id); setSelectedProjectId(fallback?.id ?? ""); setSelectedCollectionId(fallback ? tree?.collections.find((item) => item.projectId === fallback.id)?.id ?? "" : ""); setSelectedRequestId(null); } await refreshTree(); }} onOpenProjectInNewWindow={(projectId) => { const params = new URLSearchParams(); params.set("project", projectId); params.set("collection", tree?.collections.find((item) => item.projectId === projectId)?.id ?? ""); params.set("view", "resources"); window.open(`${window.location.pathname}${window.location.search}#${params}`, "_blank", "noopener,noreferrer"); }} saveTargetLabel={`${selectedProjectId} / ${selectedCollectionId}`}>
      <HttpWorkbench
        onSend={executeViaAgent}
        onCancel={cancelViaAgent}
        onPutSecret={putSecretViaAgent}
        onListCookies={listCookiesViaAgent}
        onSetCookie={setCookieViaAgent}
        onDeleteCookie={deleteCookieViaAgent}
        onSave={async (request) => { await saveRequestViaAgent(request, selectedProjectId, selectedCollectionId); await refreshTree(); }}
        onListHistory={listHistoryViaAgent}
        onReplayHistory={getHistoryItemViaAgent}
      />
      <SseWorkbench onConnect={(request, hooks) => executeEnvelopeViaAgent({ id: requestIdentity(request), protocolId: "sse", name: request.name, target: request.url, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "sse", headers: request.headers, lastEventId: request.lastEventId ?? null, reconnectMax: request.reconnectMax, reconnectDelayMs: request.reconnectDelayMs }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }, hooks)} onSave={async (request) => { await saveEnvelopeViaAgent({ id: requestIdentity(request), protocolId: "sse", name: request.name, target: request.url, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "sse", headers: request.headers, lastEventId: request.lastEventId ?? null, reconnectMax: request.reconnectMax, reconnectDelayMs: request.reconnectDelayMs }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }, selectedProjectId, selectedCollectionId); await refreshTree(); }} onCancel={cancelViaAgent} />
      <TcpWorkbench tcpSessionConnection={tcpSessionConnectionViaAgent} onSend={(request, hooks) => executeEnvelopeViaAgent({ id: requestIdentity(request), protocolId: request.protocol, name: request.name, target: request.target, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: { socketPayloadFormat: request.format ?? request.encoding, socketSourceData: request.sourceData ?? request.data }, payload: request.protocol === "tcp" ? { type: "tcp", data: request.data, encoding: request.encoding, framing: request.framing, delimiter: request.delimiter, fixedLength: request.fixedLength, sendCount: request.sendCount, intervalMs: request.intervalMs, tls: request.tls, serverName: request.serverName, caCertRef: request.caCertRef } : { type: "udp", data: request.data, encoding: request.encoding, sendCount: request.sendCount, intervalMs: request.intervalMs }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }, hooks)} onSave={async (request) => { await saveEnvelopeViaAgent({ id: requestIdentity(request), protocolId: request.protocol, name: request.name, target: request.target, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: { socketPayloadFormat: request.format ?? request.encoding, socketSourceData: request.sourceData ?? request.data }, payload: request.protocol === "tcp" ? { type: "tcp", data: request.data, encoding: request.encoding, framing: request.framing, delimiter: request.delimiter, fixedLength: request.fixedLength, sendCount: request.sendCount, intervalMs: request.intervalMs, tls: request.tls, serverName: request.serverName, caCertRef: request.caCertRef } : { type: "udp", data: request.data, encoding: request.encoding, sendCount: request.sendCount, intervalMs: request.intervalMs }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }, selectedProjectId, selectedCollectionId); await refreshTree(); }} onCancel={cancelViaAgent} />
      <UdpWorkbench onSend={(request, hooks) => executeEnvelopeViaAgent({ id: requestIdentity(request), protocolId: request.protocol, name: request.name, target: request.target, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: { socketPayloadFormat: request.format ?? request.encoding, socketSourceData: request.sourceData ?? request.data }, payload: request.protocol === "tcp" ? { type: "tcp", data: request.data, encoding: request.encoding, framing: request.framing, delimiter: request.delimiter, fixedLength: request.fixedLength, sendCount: request.sendCount, intervalMs: request.intervalMs, tls: request.tls, serverName: request.serverName, caCertRef: request.caCertRef } : { type: "udp", data: request.data, encoding: request.encoding, sendCount: request.sendCount, intervalMs: request.intervalMs }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }, hooks)} onSave={async (request) => { await saveEnvelopeViaAgent({ id: requestIdentity(request), protocolId: request.protocol, name: request.name, target: request.target, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: { socketPayloadFormat: request.format ?? request.encoding, socketSourceData: request.sourceData ?? request.data }, payload: request.protocol === "tcp" ? { type: "tcp", data: request.data, encoding: request.encoding, framing: request.framing, delimiter: request.delimiter, fixedLength: request.fixedLength, sendCount: request.sendCount, intervalMs: request.intervalMs, tls: request.tls, serverName: request.serverName, caCertRef: request.caCertRef } : { type: "udp", data: request.data, encoding: request.encoding, sendCount: request.sendCount, intervalMs: request.intervalMs }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }, selectedProjectId, selectedCollectionId); await refreshTree(); }} onCancel={cancelViaAgent} />
      <WebSocketWorkbench onConnect={(request, hooks) => executeEnvelopeViaAgent({ id: requestIdentity(request), protocolId: "websocket", name: request.name, target: request.url, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "websocket", headers: request.headers, subprotocols: request.subprotocols, messages: request.messages, receiveLimit: request.receiveLimit, reconnectMax: request.reconnectMax, reconnectDelayMs: request.reconnectDelayMs }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }, hooks)} onSave={async (request) => { await saveEnvelopeViaAgent({ id: requestIdentity(request), protocolId: "websocket", name: request.name, target: request.url, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "websocket", headers: request.headers, subprotocols: request.subprotocols, messages: request.messages, receiveLimit: request.receiveLimit, reconnectMax: request.reconnectMax, reconnectDelayMs: request.reconnectDelayMs }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }, selectedProjectId, selectedCollectionId); await refreshTree(); }} onCancel={cancelViaAgent} />
      <GrpcWorkbench onSend={(request, hooks) => executeEnvelopeViaAgent({ id: requestIdentity(request), protocolId: "grpc", name: request.name, target: request.target, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "grpc", service: request.service, method: request.method, messageBase64: request.messageBase64, messageJson: request.messageJson, descriptorSetBase64: request.descriptorSetBase64, mode: request.mode, metadata: request.metadata }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }, hooks)} onSave={async (request) => { await saveEnvelopeViaAgent({ id: requestIdentity(request), protocolId: "grpc", name: request.name, target: request.target, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "grpc", service: request.service, method: request.method, messageBase64: request.messageBase64, messageJson: request.messageJson, descriptorSetBase64: request.descriptorSetBase64, mode: request.mode, metadata: request.metadata }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }, selectedProjectId, selectedCollectionId); await refreshTree(); }} onCancel={cancelViaAgent} />
      <RedisWorkbench onSend={(request,hooks)=>executeEnvelopeViaAgent(redisRequestEnvelope(request),hooks)} onSave={async(request)=>{await saveEnvelopeViaAgent(redisRequestEnvelope(request),selectedProjectId,selectedCollectionId);await refreshTree();}} onCancel={cancelViaAgent} />
      <MqttWorkbench onSend={(request,hooks)=>executeEnvelopeViaAgent(mqttRequestEnvelope(request),hooks)} onSave={async(request)=>{await saveEnvelopeViaAgent(mqttRequestEnvelope(request),selectedProjectId,selectedCollectionId);await refreshTree();}} onCancel={cancelViaAgent} />
      <AmqpWorkbench onSend={(request,hooks)=>executeEnvelopeViaAgent(amqpRequestEnvelope(request),hooks)} onSave={async(request)=>{await saveEnvelopeViaAgent(amqpRequestEnvelope(request),selectedProjectId,selectedCollectionId);await refreshTree();}} onCancel={cancelViaAgent} />
      <KafkaWorkbench onSend={(request,hooks)=>executeEnvelopeViaAgent(kafkaRequestEnvelope(request),hooks)} onSave={async(request)=>{await saveEnvelopeViaAgent(kafkaRequestEnvelope(request),selectedProjectId,selectedCollectionId);await refreshTree();}} onCancel={cancelViaAgent} />
      <SqlWorkbench onSend={(request,hooks)=>executeEnvelopeViaAgent(sqlRequestEnvelope(request),hooks)} onSave={async(request)=>{await saveEnvelopeViaAgent(sqlRequestEnvelope(request),selectedProjectId,selectedCollectionId);await refreshTree();}} onCancel={cancelViaAgent} />
      <MockWorkbench baseUrl={agentBaseUrl} onList={listMockRulesViaAgent} onCreate={createMockRuleViaAgent} onDelete={deleteMockRuleViaAgent} />
      <GatewayWorkbench />
      <CaptureWorkbench onStatus={captureStatusViaAgent} onStart={startCaptureViaAgent} onStop={stopCaptureViaAgent} onList={listCapturesViaAgent} onClear={clearCapturesViaAgent} />
      <PluginCenter onList={listPluginsViaAgent} onInstall={installPluginViaAgent} onEnable={enablePluginViaAgent} onDelete={deletePluginViaAgent} onInvoke={invokePluginViaAgent} />
      <AiWorkbench onAssist={runAiAssistViaAgent} onPutSecret={putSecretViaAgent} />
      </WorkbenchDeck>
    </AppShell>
  );
}
