import { useEffect, useState } from "react";
import { getCollaborationUrl, subscribePreferences } from "./userPreferences";
import { Button, InlineAlert, StatusBadge, TextInput } from "./Components";

type Auth = { token: string; expiresAt: string; organizationId: string; role: string; user: { id: string; email: string; displayName: string } };
type Config = { enabled: boolean; loginPath?: string };

export function SsoWorkbench() {
  const [baseUrl, setBaseUrl] = useState(() => getCollaborationUrl());
  const [config, setConfig] = useState<Config | null>(null);
  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState<Auth | null>(null);

  useEffect(() => {
    const auth = consumeCallback();
    if (auth) { localStorage.setItem("apivoy:collaboration-auth", JSON.stringify(auth)); setConnected(auth); setMessage("企业身份验证成功，正在载入团队空间…"); queueMicrotask(()=>location.reload()); }
  }, []);
  useEffect(() => subscribePreferences((keys) => { if (keys.length === 0 || keys.includes("collaborationUrl")) setBaseUrl(getCollaborationUrl()); }), []);
  useEffect(() => { const controller=new AbortController(); setConfig(null); fetch(`${baseUrl.replace(/\/$/,"")}/v1/auth/sso/config`,{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);setConfig(await response.json() as Config);setMessage("");}).catch(error=>{if(error instanceof DOMException&&error.name==="AbortError")return;setMessage(error instanceof Error?error.message:String(error));}); return ()=>controller.abort(); }, [baseUrl]);

  function login(){if(config?.loginPath)window.location.assign(`${baseUrl.replace(/\/$/,"")}${config.loginPath}`);}
  return <section className="sso-workbench"><header className="sso-header"><div><small>ENTERPRISE IDENTITY</small><h2>单点登录</h2><p>使用企业 OIDC 身份进入团队空间。协作服务地址在设置中统一配置。</p></div><StatusBadge tone={config?.enabled ? "success" : "neutral"}>{config?.enabled?"OIDC READY":"NOT CONFIGURED"}</StatusBadge></header><div className="sso-grid"><div className="sso-card"><span className="sso-number">01</span><h3>协作服务</h3><label className="sso-field">COLLABORATION URL（只读）<TextInput value={baseUrl} readOnly /><Button variant="secondary" onClick={() => window.dispatchEvent(new CustomEvent("apivoy-open-settings"))}>在设置中修改</Button></label></div><div className="sso-card"><span className="sso-number">02</span><h3>验证企业身份</h3><p>{config?.enabled?"服务已启用 OIDC。点击后将跳转到组织身份提供商。":"管理员尚未为该服务配置 OIDC，仍可在 Team 中使用本地账号登录。"}</p><Button variant="primary" disabled={!config?.enabled} onClick={login}>使用企业账号继续</Button></div><div className="sso-card"><span className="sso-number">03</span><h3>进入团队空间</h3>{connected?<div className="sso-identity"><span>{connected.user.displayName.slice(0,1).toUpperCase()}</span><div><b>{connected.user.displayName}</b><small>{connected.user.email} · {connected.role}</small></div></div>:<p>认证完成后，登录态会安全交给 Team 和 Comments。</p>}</div></div>{message&&<InlineAlert title="身份服务状态">{message}</InlineAlert>}</section>;
}

function consumeCallback():Auth|null { const match=location.hash.match(/(?:^#|&)apivoy_sso=([^&]+)/); if(!match)return null; try { const binary=atob(match[1].replace(/-/g,"+").replace(/_/g,"/")); const bytes=Uint8Array.from(binary,char=>char.charCodeAt(0)); const auth=JSON.parse(new TextDecoder().decode(bytes)) as Auth; history.replaceState(null,"",`${location.pathname}${location.search}`); return auth; } catch { return null; } }
