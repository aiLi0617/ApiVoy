import { useEffect, useState } from "react";
import { useI18n } from "./i18n";

export interface EnvironmentEditorProps {
  onLoad: () => Promise<{ variables: Record<string, string>; secretRefs?: string[] }>;
  onSave: (variables: Record<string, string>, secretRefs: string[]) => Promise<void>;
  onPutSecret?: (name: string, value: string) => Promise<void>;
}

function formatKv(variables: Record<string, string>): string {
  return Object.entries(variables).map(([key, value]) => `${key}=${value}`).join("\n");
}

function parseKv(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    result[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1);
  }
  return result;
}

/** Shared environment editor for Settings / explorer (UX-007). */
export function EnvironmentEditor({ onLoad, onSave, onPutSecret }: EnvironmentEditorProps) {
  const { t, locale } = useI18n();
  const copy = locale === "zh-CN" ? {
    scope: "当前作用域", defaultEnvironment: "默认环境", hint: "所有协议工作台共享当前环境的参数。密钥值仅写入安全存储，项目中只保存引用名。",
    variables: "全局变量（key=value）", secretRefs: "密钥引用（逗号分隔）", secretStore: "添加密钥", secretName: "密钥名称",
    secretValue: "密钥值（仅写入安全存储）", secretSave: "保存密钥", secretSaved: "密钥已保存并关联到当前环境",
  } : {
    scope: "Current scope", defaultEnvironment: "Default environment", hint: "Parameters in the current environment are shared by every protocol workbench. Secret values stay in secure storage; projects only keep references.",
    variables: "Global variables (key=value)", secretRefs: "Secret refs (comma-separated)", secretStore: "Add secret", secretName: "Secret name",
    secretValue: "Secret value (secure storage only)", secretSave: "Save secret", secretSaved: "Secret saved and linked to the current environment",
  };
  const [text, setText] = useState("");
  const [secretRefs, setSecretRefs] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");

  async function load() {
    setBusy(true); setMessage("");
    try {
      const env = await onLoad();
      setText(formatKv(env.variables ?? {}));
      setSecretRefs((env.secretRefs ?? []).join(", "));
      setMessage(t("environments.loaded"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true); setMessage("");
    try {
      await onSave(parseKv(text), secretRefs.split(",").map((item) => item.trim()).filter(Boolean));
      setMessage(t("environments.saved"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function putSecret() {
    const name = secretName.trim();
    if (!onPutSecret || !name || !secretValue) return;
    setBusy(true); setMessage("");
    try {
      await onPutSecret(name, secretValue);
      const refs = secretRefs.split(",").map((item) => item.trim()).filter(Boolean);
      const nextRefs = refs.includes(name) ? refs : [...refs, name];
      await onSave(parseKv(text), nextRefs);
      setSecretRefs(nextRefs.join(", "));
      setSecretName("");
      setSecretValue("");
      setMessage(copy.secretSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="environment-editor">
      <div className="environment-scope"><span>{copy.scope}</span><strong>{copy.defaultEnvironment}</strong></div>
      <p className="settings-hint">{copy.hint}</p>
      <label className="settings-field">
        <span>{copy.variables}</span>
        <textarea rows={8} value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} disabled={busy} />
      </label>
      <label className="settings-field">
        <span>{copy.secretRefs}</span>
        <input value={secretRefs} onChange={(event) => setSecretRefs(event.target.value)} disabled={busy} />
      </label>
      {onPutSecret ? <div className="settings-field">
        <span>{copy.secretStore}</span>
        <div className="environment-secret-row">
          <input aria-label={copy.secretName} value={secretName} onChange={(event) => setSecretName(event.target.value)} placeholder={copy.secretName} spellCheck={false} disabled={busy} />
          <input aria-label={copy.secretValue} type="password" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} placeholder={copy.secretValue} disabled={busy} onKeyDown={(event) => { if (event.key === "Enter") void putSecret(); }} />
          <button type="button" className="ui-button secondary" disabled={busy || !secretName.trim() || !secretValue} onClick={() => void putSecret()}>{copy.secretSave}</button>
        </div>
      </div> : null}
      <div className="environment-editor-actions">
        <button type="button" className="ui-button secondary" disabled={busy} onClick={() => void load()}>{t("environments.load")}</button>
        <button type="button" className="ui-button primary" disabled={busy} onClick={() => void save()}>{t("environments.save")}</button>
      </div>
      {message ? <p className="settings-hint" role="status">{message}</p> : null}
    </div>
  );
}
