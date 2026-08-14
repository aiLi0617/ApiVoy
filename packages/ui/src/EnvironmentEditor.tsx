import { useEffect, useState } from "react";
import { createEnvironmentResource, deleteEnvironmentResource, listEnvironmentResources, updateEnvironmentResource, type EnvironmentResource } from "./agentResources";
import { Icon } from "./Icons";

export interface EnvironmentEditorProps {
  onLoad: () => Promise<{ variables: Record<string, string>; secretRefs?: string[] }>;
  onSave: (variables: Record<string, string>, secretRefs: string[]) => Promise<void>;
  onPutSecret?: (name: string, value: string) => Promise<void>;
}

type Section = "global-variables" | "global-parameters" | "vault" | string;
const GLOBAL_PARAMETERS_KEY = "apivoy:global-parameters:v1";

function formatKv(values: Record<string, string>): string {
  return Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n");
}

function parseKv(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index > 0) result[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1);
  }
  return result;
}

function environmentBadge(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "环";
}

function KeyValueEditor({ value, onChange, disabled, kind }: { value: string; onChange: (value: string) => void; disabled: boolean; kind: "变量" | "参数" }) {
  const entries = Object.entries(parseKv(value));
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const update = (index: number, field: "key" | "value", nextValue: string) => {
    const next = entries.map(([key, itemValue], itemIndex) => itemIndex === index ? [field === "key" ? nextValue : key, field === "value" ? nextValue : itemValue] as [string, string] : [key, itemValue] as [string, string]);
    onChange(next.filter(([key]) => key.trim()).map(([key, itemValue]) => `${key}=${itemValue}`).join("\n"));
  };
  const add = (key: string, itemValue: string) => {
    if (!key.trim()) return;
    onChange([...entries, [key, itemValue] as [string, string]].filter(([itemKey]) => itemKey.trim()).map(([itemKey, value]) => `${itemKey}=${value}`).join("\n"));
    setNewKey("");
    setNewValue("");
  };
  return <div className="environment-kv-editor">
    <div className="environment-kv-header"><span>{kind}名称</span><span>{kind}值</span><span>说明</span><span/></div>
    {entries.map(([key, itemValue], index) => <div className="environment-kv-row" key={`${key}-${index}`}><input aria-label={`${kind}名称 ${index + 1}`} value={key} onChange={(event) => update(index, "key", event.target.value)} disabled={disabled}/><input aria-label={`${kind}值 ${index + 1}`} value={itemValue} onChange={(event) => update(index, "value", event.target.value)} disabled={disabled}/><input aria-label={`${kind}说明 ${index + 1}`} placeholder="可选说明" disabled={disabled}/><button type="button" aria-label={`删除${kind} ${key}`} title="删除" disabled={disabled} onClick={() => onChange(entries.filter((_, itemIndex) => itemIndex !== index).map(([itemKey, value]) => `${itemKey}=${value}`).join("\n"))}><Icon name="trash"/></button></div>)}
    <div className="environment-kv-row environment-kv-new"><input aria-label={`新${kind}名称`} value={newKey} onChange={(event) => setNewKey(event.target.value)} placeholder={`添加${kind}`} disabled={disabled}/><input aria-label={`新${kind}值`} value={newValue} onChange={(event) => setNewValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") add(newKey, newValue); }} placeholder={`${kind}值`} disabled={disabled}/><input aria-label={`新${kind}说明`} placeholder="可选说明" disabled={disabled}/><button type="button" aria-label={`添加${kind}`} title="添加" disabled={disabled || !newKey.trim()} onClick={() => add(newKey, newValue)}><Icon name="plus"/></button></div>
  </div>;
}

export function EnvironmentEditor({ onLoad, onSave, onPutSecret }: EnvironmentEditorProps) {
  const [environments, setEnvironments] = useState<EnvironmentResource[]>([]);
  const [defaultVariables, setDefaultVariables] = useState<Record<string, string>>({});
  const [defaultSecretRefs, setDefaultSecretRefs] = useState<string[]>([]);
  const [active, setActive] = useState<Section>("global-variables");
  const [text, setText] = useState("");
  const [globalParameters, setGlobalParameters] = useState(() => localStorage.getItem(GLOBAL_PARAMETERS_KEY) ?? "");
  const [secretRefs, setSecretRefs] = useState("");
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [environmentName, setEnvironmentName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedEnvironment = environments.find((item) => item.id === active);

  async function reload() {
    setBusy(true);
    setMessage("");
    try {
      const [list, defaults] = await Promise.all([listEnvironmentResources().catch(() => []), onLoad()]);
      setEnvironments(list.filter((item) => item.id !== "default-env"));
      setDefaultVariables(defaults.variables ?? {});
      setDefaultSecretRefs(defaults.secretRefs ?? []);
      setMessage("环境配置已加载");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    if (active === "global-variables") setText(formatKv(defaultVariables));
    else if (active === "vault") setSecretRefs(defaultSecretRefs.join(", "));
    else if (selectedEnvironment) { setText(formatKv(selectedEnvironment.variables)); setEnvironmentName(selectedEnvironment.name); }
  }, [active, defaultVariables, defaultSecretRefs, selectedEnvironment]);

  async function saveCurrent() {
    setBusy(true);
    setMessage("");
    try {
      if (active === "global-parameters") {
        localStorage.setItem(GLOBAL_PARAMETERS_KEY, globalParameters);
      } else if (active === "vault") {
        const refs = secretRefs.split(",").map((item) => item.trim()).filter(Boolean);
        await onSave(defaultVariables, refs);
        setDefaultSecretRefs(refs);
      } else if (selectedEnvironment) {
        const updated = await updateEnvironmentResource({ ...selectedEnvironment, name: environmentName.trim() || "未命名环境", variables: parseKv(text) });
        setEnvironments((items) => items.map((item) => item.id === updated.id ? updated : item));
      } else {
        const values = parseKv(text);
        await onSave(values, defaultSecretRefs);
        setDefaultVariables(values);
      }
      setMessage("配置已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function addEnvironment() {
    setBusy(true);
    try {
      const created = await createEnvironmentResource({ projectId: "default-project", name: "未命名环境", variables: {}, secretRefs: [] });
      setEnvironments((items) => [...items, created]);
      setActive(created.id);
    } finally { setBusy(false); }
  }

  async function copyEnvironment() {
    if (!selectedEnvironment) return;
    setBusy(true);
    try {
      const created = await createEnvironmentResource({ ...selectedEnvironment, id: undefined, name: `${selectedEnvironment.name} 副本` });
      setEnvironments((items) => [...items, created]);
      setActive(created.id);
    } finally { setBusy(false); }
  }

  async function removeEnvironment() {
    if (!selectedEnvironment || !window.confirm(`删除环境“${selectedEnvironment.name}”？`)) return;
    setBusy(true);
    try {
      await deleteEnvironmentResource(selectedEnvironment.id);
      setEnvironments((items) => items.filter((item) => item.id !== selectedEnvironment.id));
      setActive("global-variables");
    } finally { setBusy(false); }
  }

  async function putSecret() {
    const name = secretName.trim();
    if (!onPutSecret || !name || !secretValue) return;
    setBusy(true);
    try {
      await onPutSecret(name, secretValue);
      const refs = Array.from(new Set([...defaultSecretRefs, name]));
      await onSave(defaultVariables, refs);
      setDefaultSecretRefs(refs);
      setSecretRefs(refs.join(", "));
      setSecretName("");
      setSecretValue("");
      setMessage("密钥已写入安全存储");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }

  const editorTitle = active === "global-variables" ? "全局变量" : active === "global-parameters" ? "全局参数" : active === "vault" ? "Vault Secrets（密钥库）" : selectedEnvironment?.name ?? "环境";
  const editorHint = active === "global-variables" ? "所有环境和协议请求均可引用的公共变量。" : active === "global-parameters" ? "独立于环境的公共请求参数，按 key=value 每行填写一项。" : active === "vault" ? "密钥值只写入系统安全存储，项目中仅保存引用名称。" : "当前环境的变量会覆盖同名全局变量。";

  return <div className="environment-manager">
    <aside className="environment-manager-nav" aria-label="环境配置导航">
      <section><div className="environment-nav-label">全局</div>
        <button className={active === "global-variables" ? "is-active" : undefined} onClick={() => setActive("global-variables")}><Icon name="globe"/><span>全局变量</span></button>
        <button className={active === "global-parameters" ? "is-active" : undefined} onClick={() => setActive("global-parameters")}><Icon name="sliders"/><span>全局参数</span></button>
        <button className={active === "vault" ? "is-active" : undefined} onClick={() => setActive("vault")}><Icon name="archive"/><span>Vault Secrets（密钥库）</span></button>
      </section>
      <section className="environment-list"><div className="environment-nav-label">环境</div>
        {environments.map((environment) => <button key={environment.id} className={active === environment.id ? "is-active" : undefined} onClick={() => setActive(environment.id)}><b>{environmentBadge(environment.name)}</b><span>{environment.name}</span></button>)}
        <button className="environment-add" disabled={busy} onClick={() => void addEnvironment()}><Icon name="plus"/><span>新建环境</span></button>
      </section>
    </aside>
    <main className="environment-manager-content">
      <header><div><span className="environment-title-badge">{active === "vault" ? "密" : active.startsWith("global-") ? "全" : environmentBadge(editorTitle)}</span><div>{selectedEnvironment ? <input className="environment-name-input" aria-label="环境名称" value={environmentName} onChange={(event) => setEnvironmentName(event.target.value)} placeholder="填写环境名称" disabled={busy}/> : <h3>{editorTitle}</h3>}<p>{editorHint}</p></div></div>
        {selectedEnvironment ? <div className="environment-item-actions"><button className="ui-button secondary" disabled={busy} onClick={() => void copyEnvironment()}><Icon name="copy"/>复制</button><button className="ui-button danger" disabled={busy} onClick={() => void removeEnvironment()}><Icon name="trash"/>删除</button></div> : null}
      </header>
      <div className="environment-editor-panel">
        {active === "vault" ? <>
          <label className="settings-field"><span>已关联的密钥引用</span><input value={secretRefs} onChange={(event) => setSecretRefs(event.target.value)} placeholder="例如：api_token, client_secret" disabled={busy}/></label>
          {onPutSecret ? <div className="environment-vault-card"><div><strong>添加或更新密钥</strong><small>保存后无法读取明文，只能通过引用名称使用。</small></div><div className="environment-secret-row"><input aria-label="密钥名称" value={secretName} onChange={(event) => setSecretName(event.target.value)} placeholder="密钥名称" disabled={busy}/><input aria-label="密钥值" type="password" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} placeholder="密钥值" disabled={busy}/><button className="ui-button secondary" disabled={busy || !secretName.trim() || !secretValue} onClick={() => void putSecret()}>保存密钥</button></div></div> : null}
        </> : <KeyValueEditor kind={active === "global-parameters" ? "参数" : "变量"} value={active === "global-parameters" ? globalParameters : text} onChange={active === "global-parameters" ? setGlobalParameters : setText} disabled={busy}/>} 
      </div>
      <footer><span role="status">{message}</span><div><button className="ui-button secondary" disabled={busy} onClick={() => void reload()}>重新加载</button><button className="ui-button primary" disabled={busy} onClick={() => void saveCurrent()}>保存</button></div></footer>
    </main>
  </div>;
}
