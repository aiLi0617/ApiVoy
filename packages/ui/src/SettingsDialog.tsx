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
import { EnvironmentEditor, type EnvironmentEditorProps } from "./EnvironmentEditor";
import { useDialogFocus } from "./useDialogFocus";

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  channelLabel: string;
  environment?: EnvironmentEditorProps;
}

export function SettingsDialog({ open, onClose, channelLabel, environment }: SettingsDialogProps) {
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
            <h2 id={titleId}>{t("settings.title")}</h2>
            <p>{t("settings.subtitle")}</p>
          </div>
          <button ref={closeRef} type="button" className="ui-icon-button" aria-label={t("action.close")} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        <div className="settings-dialog-body">
          <section className="settings-section">
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

          <section className="settings-section">
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

          <section className="settings-section">
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

          <section className="settings-section">
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

          <section className="settings-section">
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

          <section className="settings-section">
            <h3>{locale === "zh-CN" ? "全局参数" : "Global parameters"}</h3>
            {environment ? <EnvironmentEditor {...environment} /> : <p className="settings-hint">{t("environments.unavailable")}</p>}
          </section>

          <section className="settings-section">
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

          <section className="settings-section">
            <h3>{t("settings.section.plugins")}</h3>
            <p className="settings-hint">{t("settings.plugins.hint")}</p>
            <div className="environment-editor-actions">
              <button type="button" className="ui-button secondary" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("apivoy-select-workbench", { detail: "plugins" })); }}>{t("settings.openWorkbench", { name: "Plugins" })}</button>
              <button type="button" className="ui-button secondary" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("apivoy-select-workbench", { detail: "ai" })); }}>{t("settings.openWorkbench", { name: "AI" })}</button>
            </div>
          </section>
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
