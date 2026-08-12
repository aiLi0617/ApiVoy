import { useEffect, useState } from "react";
import { useI18n } from "./i18n";

export interface EnvironmentEditorProps {
  onLoad: () => Promise<{ variables: Record<string, string>; secretRefs?: string[] }>;
  onSave: (variables: Record<string, string>, secretRefs: string[]) => Promise<void>;
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
export function EnvironmentEditor({ onLoad, onSave }: EnvironmentEditorProps) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [secretRefs, setSecretRefs] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

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

  useEffect(() => { void load(); }, []);

  return (
    <div className="environment-editor">
      <p className="settings-hint">{t("environments.hint")}</p>
      <label className="settings-field">
        <span>{t("environments.variables")}</span>
        <textarea rows={8} value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} disabled={busy} />
      </label>
      <label className="settings-field">
        <span>{t("environments.secretRefs")}</span>
        <input value={secretRefs} onChange={(event) => setSecretRefs(event.target.value)} disabled={busy} />
      </label>
      <div className="environment-editor-actions">
        <button type="button" className="ui-button secondary" disabled={busy} onClick={() => void load()}>{t("environments.load")}</button>
        <button type="button" className="ui-button primary" disabled={busy} onClick={() => void save()}>{t("environments.save")}</button>
      </div>
      {message ? <p className="settings-hint" role="status">{message}</p> : null}
    </div>
  );
}
