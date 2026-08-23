import { useEffect, useId, useRef, useState } from "react";
import { useAppStore, type ThemeMode } from "./appStore";
import { Icon } from "./Icons";
import { useI18n, type Locale } from "./i18n";
import {
  getAiEndpoint,
  getAiModel,
  getAiSecretRef,
  getAgentToken,
  getAgentUrl,
  getCollaborationUrl,
  getGatewayKey,
  getGatewayUrl,
  setAiEndpoint,
  setAiModel,
  setAiSecretRef,
  setAgentToken,
  setAgentUrl,
  setCollaborationUrl,
  setGatewayKey,
  setGatewayUrl,
} from "./userPreferences";
import { useDialogFocus } from "./useDialogFocus";

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  channelLabel: string;
}

export function SettingsDialog({ open, onClose, channelLabel }: SettingsDialogProps) {
  const { locale, setLocale, t } = useI18n();
  const themeMode = useAppStore((state) => state.themeMode);
  const setThemeMode = useAppStore((state) => state.setThemeMode);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const [collaborationUrl, setCollaborationUrlState] = useState(getCollaborationUrl);
  const [agentUrl, setAgentUrlState] = useState(getAgentUrl);
  const [agentToken, setAgentTokenState] = useState(getAgentToken);
  const [aiEndpoint, setAiEndpointState] = useState(getAiEndpoint);
  const [aiModel, setAiModelState] = useState(getAiModel);
  const [aiSecretRef, setAiSecretRefState] = useState(getAiSecretRef);
  const [gatewayUrl, setGatewayUrlState] = useState(getGatewayUrl);
  const [gatewayKey, setGatewayKeyState] = useState(getGatewayKey);
  const [saved, setSaved] = useState(false);
  const [category, setCategory] = useState<"general" | "connection" | "ai" | "collaboration" | "plugins" | "shortcuts" | "about">("general");
  const categories = [
    ["general", locale === "zh-CN" ? "通用" : "General"], ["connection", locale === "zh-CN" ? "连接" : "Connections"], ["ai", "AI"],
    ["collaboration", locale === "zh-CN" ? "协作" : "Collaboration"], ["plugins", locale === "zh-CN" ? "插件" : "Plugins"], ["shortcuts", locale === "zh-CN" ? "快捷键" : "Shortcuts"], ["about", locale === "zh-CN" ? "关于" : "About"],
  ] as const;

  useEffect(() => {
    if (!open) return;
    setCollaborationUrlState(getCollaborationUrl());
    setAgentUrlState(getAgentUrl());
    setAgentTokenState(getAgentToken());
    setAiEndpointState(getAiEndpoint());
    setAiModelState(getAiModel());
    setAiSecretRefState(getAiSecretRef());
    setGatewayUrlState(getGatewayUrl());
    setGatewayKeyState(getGatewayKey());
    setSaved(false);
  }, [open]);
  useDialogFocus(open, dialogRef, onClose, closeRef);

  function saveSettings() {
    setCollaborationUrl(collaborationUrl); setAgentUrl(agentUrl); setAgentToken(agentToken);
    setAiEndpoint(aiEndpoint); setAiModel(aiModel); setAiSecretRef(aiSecretRef);
    setGatewayUrl(gatewayUrl); setGatewayKey(gatewayKey); setSaved(true);
  }

  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-dialog-header">
          <div>
            <span className="settings-scope-label">{locale === "zh-CN" ? "软件级" : "Application-wide"}</span>
            <h2 id={titleId}>{locale === "zh-CN" ? "软件设置" : "Application settings"}</h2>
            <p>{locale === "zh-CN" ? "应用于 ApiVoy 软件和当前设备，不随项目切换，也不会写入项目文件。" : "Applies to ApiVoy on this device. These values do not change with projects or enter project files."}</p>
          </div>
          <button ref={closeRef} type="button" className="ui-icon-button" aria-label={t("action.close")} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        <div className="settings-dialog-body" data-category={category}>
          <nav className="settings-categories" aria-label="设置分类">
            <label>设置分类<select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>{categories.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <div>{categories.map(([id, label]) => <button key={id} type="button" className={category === id ? "is-active" : undefined} aria-current={category === id ? "page" : undefined} onClick={() => setCategory(id)}>{label}</button>)}</div>
          </nav>
          <div className="settings-content">
          <section className="settings-section category-general">
            <h3>{t("settings.section.appearance")}</h3>
            <label className="settings-field">
              <span>{t("settings.theme")}</span>
              <select
                value={themeMode}
                onChange={(event) => setThemeMode(event.target.value as ThemeMode)}
                aria-label={t("settings.theme")}
              >
                <option value="dark">{t("settings.theme.dark")}</option>
                <option value="light">{t("settings.theme.light")}</option>
                <option value="system">{t("settings.theme.system")}</option>
              </select>
            </label>
          </section>

          <section className="settings-section category-general">
            <h3>{t("settings.section.language")}</h3>
            <label className="settings-field">
              <span>{t("locale.label")}</span>
              <select
                value={locale}
                onChange={(event) => setLocale(event.target.value as Locale)}
                aria-label={t("locale.label")}
              >
                <option value="zh-CN">{t("locale.zh")}</option>
                <option value="en-US">{t("locale.en")}</option>
              </select>
            </label>
          </section>

          <section className="settings-section category-connection">
            <h3>{t("settings.section.agent")}</h3>
            <p className="settings-hint">{t("settings.agent.channel", { channel: channelLabel })}</p>
            <label className="settings-field">
              <span>{t("settings.agent.url")}</span>
              <input
                value={agentUrl}
                onChange={(event) => {
                  setAgentUrlState(event.target.value);
                  setSaved(false);
                }}
                spellCheck={false}
              />
            </label>
            <label className="settings-field">
              <span>{t("settings.agent.token")}</span>
              <input
                type="password"
                value={agentToken}
                onChange={(event) => {
                  setAgentTokenState(event.target.value);
                  setSaved(false);
                }}
                autoComplete="off"
              />
            </label>
            <p className="settings-hint">{t("settings.agent.reload")}</p>
            <p className="settings-hint">{t("settings.agent.setup")}</p>
          </section>

          <section className="settings-section category-collaboration">
            <h3>{t("settings.section.collaboration")}</h3>
            <label className="settings-field">
              <span>{t("settings.collaboration.url")}</span>
              <input
                value={collaborationUrl}
                onChange={(event) => {
                  setCollaborationUrlState(event.target.value);
                  setSaved(false);
                }}
                spellCheck={false}
              />
            </label>
            <button type="button" className="ui-button secondary" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("apivoy-open-collaboration", { detail: "team" })); }}>
              {t("collaboration.open")}
            </button>
          </section>

          <section className="settings-section category-ai">
            <h3>{t("settings.section.ai")}</h3>
            <label className="settings-field">
              <span>{t("settings.ai.endpoint")}</span>
              <input
                value={aiEndpoint}
                onChange={(event) => {
                  setAiEndpointState(event.target.value);
                  setSaved(false);
                }}
                spellCheck={false}
              />
            </label>
            <label className="settings-field">
              <span>{t("settings.ai.model")}</span>
              <input
                value={aiModel}
                onChange={(event) => {
                  setAiModelState(event.target.value);
                  setSaved(false);
                }}
                spellCheck={false}
              />
            </label>
            <label className="settings-field">
              <span>{t("settings.ai.secretRef")}</span>
              <input
                value={aiSecretRef}
                onChange={(event) => {
                  setAiSecretRefState(event.target.value);
                  setSaved(false);
                }}
                spellCheck={false}
              />
            </label>
            <p className="settings-hint">{t("settings.ai.keyHint")}</p>
            <button type="button" className="ui-button secondary" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("apivoy-select-workbench", { detail: "ai" })); }}>{t("settings.openWorkbench", { name: "AI" })}</button>
          </section>

          <section className="settings-section category-connection">
            <h3>{t("settings.section.gateway")}</h3>
            <label className="settings-field">
              <span>{t("settings.gateway.url")}</span>
              <input
                value={gatewayUrl}
                onChange={(event) => {
                  setGatewayUrlState(event.target.value);
                  setSaved(false);
                }}
                spellCheck={false}
              />
            </label>
            <label className="settings-field">
              <span>{t("settings.gateway.key")}</span>
              <input
                type="password"
                value={gatewayKey}
                onChange={(event) => {
                  setGatewayKeyState(event.target.value);
                  setSaved(false);
                }}
                autoComplete="off"
              />
            </label>
            <button type="button" className="ui-button secondary" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("apivoy-select-workbench", { detail: "gateway" })); }}>{t("settings.openWorkbench", { name: "Gateway" })}</button>
          </section>

          <section className="settings-section category-plugins">
            <h3>{t("settings.section.plugins")}</h3>
            <p className="settings-hint">{t("settings.plugins.hint")}</p>
            <div className="environment-editor-actions">
              <button type="button" className="ui-button secondary" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("apivoy-select-workbench", { detail: "plugins" })); }}>{t("settings.openWorkbench", { name: "Plugins" })}</button>
              <button type="button" className="ui-button secondary" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("apivoy-select-workbench", { detail: "ai" })); }}>{t("settings.openWorkbench", { name: "AI" })}</button>
            </div>
          </section>
          <section className="settings-section category-shortcuts">
            <h3>快捷键</h3>
            <p className="settings-hint">快捷键集中展示在这里，后续版本将在此提供自定义配置。</p>
            <dl className="shortcut-list"><div><dt>发送请求</dt><dd><kbd>Ctrl/⌘</kbd> + <kbd>Enter</kbd></dd></div><div><dt>命令面板</dt><dd><kbd>Ctrl/⌘</kbd> + <kbd>K</kbd></dd></div><div><dt>打开设置</dt><dd><kbd>Ctrl/⌘</kbd> + <kbd>,</kbd></dd></div><div><dt>关闭弹窗或面板</dt><dd><kbd>Esc</kbd></dd></div></dl>
          </section>
          <section className="settings-section category-about">
            <h3>关于 ApiVoy</h3><p className="settings-hint">ApiVoy · Explore Every Protocol.</p><p className="settings-hint">本地优先的多协议 API 调试与协作工具。</p>
          </section>
          </div>
        </div>

        <footer className="settings-dialog-footer">
          <span role="status" aria-live="polite">{saved ? (locale === "zh-CN" ? "设置已保存；Agent 连接设置将在刷新后完全生效。" : "Settings saved; Agent connection changes fully apply after reload.") : ""}</span>
          <button type="button" className="ui-button secondary" onClick={onClose}>{t("action.cancel")}</button>
          <button type="button" className="ui-button primary" onClick={saveSettings}>{t("action.save")}</button>
        </footer>
      </div>
    </div>
  );
}
