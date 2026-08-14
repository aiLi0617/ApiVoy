import { PROTOCOL_API_VERSION } from "@apivoy/request-model";
import { getAgentToken,getAgentUrl } from "./userPreferences";
import type { ScriptAsset } from "./scriptLibrary";
export interface EnvironmentResource { id:string;projectId:string;name:string;variables:Record<string,string>;secretRefs:string[];updatedAt:string }
let sessionToken="";let sessionPromise:Promise<void>|null=null;
async function headers(){const bootstrap=getAgentToken();if(!sessionPromise){sessionPromise=(async()=>{if(!bootstrap)return;const response=await fetch(`${getAgentUrl().replace(/\/$/,"")}/v1/session`,{method:"POST",headers:{Authorization:`Bearer ${bootstrap}`,"X-ApiVoy-Protocol-Api-Version":PROTOCOL_API_VERSION}});if(response.ok)sessionToken=((await response.json()) as {token:string}).token})()}await sessionPromise;return {"Content-Type":"application/json","X-ApiVoy-Protocol-Api-Version":PROTOCOL_API_VERSION,...((sessionToken||bootstrap)?{Authorization:`Bearer ${sessionToken||bootstrap}`}:{})}}
async function request<T>(path:string,method="GET",body?:unknown):Promise<T>{const response=await fetch(`${getAgentUrl().replace(/\/$/,"")}${path}`,{method,headers:await headers(),body:body===undefined?undefined:JSON.stringify(body)});if(!response.ok)throw new Error(await response.text());return response.status===204?undefined as T:response.json()}
export const listEnvironmentResources=(projectId?:string)=>request<EnvironmentResource[]>(`/v1/environments${projectId?`?projectId=${encodeURIComponent(projectId)}`:""}`);
export const createEnvironmentResource=(value:Partial<EnvironmentResource>)=>request<EnvironmentResource>("/v1/environments","POST",value);
export const updateEnvironmentResource=(value:EnvironmentResource)=>request<EnvironmentResource>(`/v1/environments/${encodeURIComponent(value.id)}`,"PUT",value);
export const deleteEnvironmentResource=(id:string)=>request<void>(`/v1/environments/${encodeURIComponent(id)}`,"DELETE");
export const listScriptResources=(projectId:string)=>request<ScriptAsset[]>(`/v1/scripts?projectId=${encodeURIComponent(projectId)}`);
export const createScriptResource=(value:ScriptAsset)=>request<ScriptAsset>("/v1/scripts","POST",value);
export const updateScriptResource=(value:ScriptAsset)=>request<ScriptAsset>(`/v1/scripts/${encodeURIComponent(value.id)}`,"PUT",value);
export const deleteScriptResource=(id:string)=>request<void>(`/v1/scripts/${encodeURIComponent(id)}`,"DELETE");
