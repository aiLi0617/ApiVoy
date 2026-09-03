import { useEffect, useState } from "react";
import { EmptyState, LoadingState, useFeedback } from "./Feedback";
import { Button, Checkbox, InlineAlert, StatusBadge, Textarea, TextInput } from "./Components";

export interface PluginManifest { id: string; name: string; version: string; kind: "protocol" | "auth" | "importer" | "transformer"; permissions: Array<"network" | "filesystem_read" | "filesystem_write" | "secrets_read">; description: string; publisherKeyId?: string | null; signatureBase64?: string | null }
export interface InstalledPlugin { manifest: PluginManifest; enabled: boolean; sha256: string; signatureVerified: boolean }
export interface PluginCenterProps { onList: () => Promise<InstalledPlugin[]>; onInstall: (manifest: PluginManifest, wasmBase64: string) => Promise<void>; onEnable: (id: string, enabled: boolean) => Promise<void>; onDelete: (id: string) => Promise<void>; onInvoke: (id: string, input: string) => Promise<string> }

export function PluginCenter(props: PluginCenterProps) {
  const { confirm, notify } = useFeedback();
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [manifestText, setManifestText] = useState('{\n  "id": "example-transform",\n  "name": "Example Transform",\n  "version": "1.0.0",\n  "kind": "transformer",\n  "permissions": [],\n  "description": ""\n}');
  const [wasm, setWasm] = useState<File | null>(null);
  const [input, setInput] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    setState("loading"); setLoadError("");
    try { setPlugins(await props.onList()); setState("ready"); }
    catch (error) { setLoadError(error instanceof Error ? error.message : String(error)); setState("error"); }
  }
  useEffect(() => { void refresh(); }, []);

  async function install() {
    if (!wasm) { setMessage("请选择 .wasm Component 文件"); return; }
    try {
      const manifest = JSON.parse(manifestText) as PluginManifest;
      const bytes = new Uint8Array(await wasm.arrayBuffer()); let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      await props.onInstall(manifest, btoa(binary)); await refresh(); setMessage("插件安装成功"); notify("插件安装成功", "success");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  return <section className="plugin-center">
    <div className="plugin-center-title"><div><small>SANDBOXED EXTENSIONS</small><h2>WASM 插件中心</h2></div><StatusBadge tone="info">COMPONENT ONLY · NO WASI BY DEFAULT</StatusBadge></div>
    <div className="plugin-install">
      <label className="plugin-field">插件 Manifest<Textarea aria-label="插件 Manifest" className="plugin-manifest" value={manifestText} onChange={(event) => setManifestText(event.target.value)}/></label>
      <div className="plugin-install-actions">
        <label className="plugin-field">WASM Component<input className="plugin-file-input" type="file" accept=".wasm" onChange={(event) => setWasm(event.target.files?.[0] ?? null)}/></label>
        <Button variant="primary" onClick={() => void install()}>安装插件</Button>
        <label className="plugin-field">调用测试输入<TextInput value={input} onChange={(event) => setInput(event.target.value)} placeholder="transform 测试输入"/></label>
        {message && <small role="status" aria-live="polite">{message}</small>}
      </div>
    </div>
    <div className="plugin-list">
      {state === "loading" ? <LoadingState label="正在加载插件…"/> : state === "error" ? <InlineAlert tone="danger" title="插件加载失败"><span>{loadError}</span><Button variant="secondary" onClick={() => void refresh()}>重试</Button></InlineAlert> : plugins.length === 0 ? <EmptyState title="还没有插件" description="粘贴 Manifest 并选择 .wasm Component 后安装。"/> : plugins.map((plugin) => <div className="plugin-row" key={plugin.manifest.id}>
        <div><b>{plugin.manifest.name}</b><small>{plugin.manifest.id} · v{plugin.manifest.version} · {plugin.manifest.kind}</small><code title={plugin.sha256}>sha256 {plugin.sha256.slice(0, 16)}…</code></div>
        <Checkbox label="启用" checked={plugin.enabled} onChange={async (event) => { await props.onEnable(plugin.manifest.id, event.target.checked); await refresh(); }}/>
        <Button size="compact" onClick={async () => { try { setMessage(await props.onInvoke(plugin.manifest.id, input)); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>调用</Button>
        <Button size="compact" variant="danger" onClick={async () => { if (await confirm({ title: "卸载插件", description: `卸载插件 ${plugin.manifest.name}？`, tone: "danger", confirmLabel: "卸载" })) { await props.onDelete(plugin.manifest.id); await refresh(); } }}>卸载</Button>
      </div>)}
    </div>
  </section>;
}
