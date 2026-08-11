import { useSyncExternalStore } from "react";

export type Locale = "zh-CN" | "en-US";
type MessageKey = keyof typeof zhCN;

const zhCN = {
  "app.tagline": "探索每一种协议。",
  "channel.current": "当前执行通道",
  "command.open": "打开命令面板",
  "command.title": "命令面板 Ctrl/⌘+K",
  "command.placeholder": "跳转到工作台…",
  "command.jump": "跳转",
  "command.empty": "没有匹配的工作台",
  "region.fallback": "区域 {index}",
  "nav.main": "主导航",
  "nav.requests": "请求",
  "nav.collections": "集合",
  "nav.history": "历史",
  "nav.environments": "环境",
  "workspace.local": "本地工作区",
  "locale.label": "语言",
  "locale.zh": "中文",
  "locale.en": "English",
  "action.save": "保存",
  "action.cancel": "取消",
  "action.copy": "复制",
  "action.delete": "删除",
  "action.connect": "连接",
  "action.send": "发送",
  "action.import": "导入",
  "action.export": "导出",
  "action.close": "关闭",
  "status.idle": "空闲",
  "status.connected": "已连接",
  "codegen.title": "代码生成",
  "codegen.plugin": "插件",
  "workbench.http": "HTTP",
  "workbench.sse": "SSE",
  "workbench.socket": "TCP / UDP",
  "workbench.graphql": "GraphQL",
  "workbench.websocket": "WebSocket",
  "workbench.grpc": "gRPC",
  "workbench.rpc": "SOAP / RPC",
  "workbench.redis": "Redis",
  "workbench.mqtt": "MQTT",
  "workbench.amqp": "AMQP",
  "workbench.kafka": "Kafka",
  "workbench.sql": "SQL",
  "workbench.mock": "Mock",
  "workbench.plugins": "插件",
  "workbench.runner": "集合运行",
  "workbench.gateway": "云网关",
  "workbench.team": "团队",
  "workbench.comments": "评论",
  "workbench.sso": "SSO",
  "workbench.ai": "AI",
  "workbench.capture": "抓包",
  "workbench.navigation": "协议工作台",
} as const;

const enUS: Record<MessageKey, string> = {
  "app.tagline": "Explore Every Protocol.",
  "channel.current": "Current execution channel",
  "command.open": "Open command palette",
  "command.title": "Command palette Ctrl/⌘+K",
  "command.placeholder": "Jump to a workbench…",
  "command.jump": "Jump",
  "command.empty": "No matching workbench",
  "region.fallback": "Section {index}",
  "nav.main": "Main navigation",
  "nav.requests": "Requests",
  "nav.collections": "Collections",
  "nav.history": "History",
  "nav.environments": "Environments",
  "workspace.local": "Local workspace",
  "locale.label": "Language",
  "locale.zh": "中文",
  "locale.en": "English",
  "action.save": "Save",
  "action.cancel": "Cancel",
  "action.copy": "Copy",
  "action.delete": "Delete",
  "action.connect": "Connect",
  "action.send": "Send",
  "action.import": "Import",
  "action.export": "Export",
  "action.close": "Close",
  "status.idle": "Idle",
  "status.connected": "Connected",
  "codegen.title": "Code generation",
  "codegen.plugin": "Plugin",
  "workbench.http": "HTTP",
  "workbench.sse": "SSE",
  "workbench.socket": "TCP / UDP",
  "workbench.graphql": "GraphQL",
  "workbench.websocket": "WebSocket",
  "workbench.grpc": "gRPC",
  "workbench.rpc": "SOAP / RPC",
  "workbench.redis": "Redis",
  "workbench.mqtt": "MQTT",
  "workbench.amqp": "AMQP",
  "workbench.kafka": "Kafka",
  "workbench.sql": "SQL",
  "workbench.mock": "Mock",
  "workbench.plugins": "Plugins",
  "workbench.runner": "Runner",
  "workbench.gateway": "Gateway",
  "workbench.team": "Team",
  "workbench.comments": "Comments",
  "workbench.sso": "SSO",
  "workbench.ai": "AI",
  "workbench.capture": "Capture",
  "workbench.navigation": "Protocol workbenches",
};

const resources: Record<Locale, Record<MessageKey, string>> = { "zh-CN": zhCN, "en-US": enUS };
const listeners = new Set<() => void>();

function browserLocale(): Locale {
  try {
    const saved = localStorage.getItem("apivoy:locale");
    if (saved === "zh-CN" || saved === "en-US") return saved;
  } catch { /* use browser preference */ }
  return typeof navigator !== "undefined" && !navigator.language.toLowerCase().startsWith("zh") ? "en-US" : "zh-CN";
}

let locale: Locale = typeof window === "undefined" ? "zh-CN" : browserLocale();

export function getLocale(): Locale { return locale; }
export function setLocale(next: Locale): void {
  if (locale === next) return;
  locale = next;
  try { localStorage.setItem("apivoy:locale", next); } catch { /* persistence is optional */ }
  if (typeof document !== "undefined") document.documentElement.lang = next;
  listeners.forEach((listener) => listener());
}

export function translate(key: MessageKey, variables: Record<string, string | number> = {}): string {
  return resources[locale][key].replace(/\{(\w+)\}/g, (_, name: string) => String(variables[name] ?? `{${name}}`));
}

export function translateWorkbench(id: string, fallback: string): string {
  const key = `workbench.${id}` as MessageKey;
  return key in resources[locale] ? resources[locale][key] : fallback;
}

export function useI18n() {
  const current = useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, getLocale, () => "zh-CN" as Locale);
  return { locale: current, setLocale, t: translate };
}
