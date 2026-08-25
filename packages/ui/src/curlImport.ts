import { isSensitiveHeaderName, type HttpWorkbenchRequest } from "./HttpWorkbench";

export interface CurlImportResult { request: HttpWorkbenchRequest; warnings: string[] }

function shellTokens(source: string): string[] {
  const tokens: string[] = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s]+)/g;
  let match: RegExpExecArray | null;
  const normalized = source.replace(/\\\r?\n/g, " ").replace(/\^\r?\n/g, " ");
  while ((match = pattern.exec(normalized))) tokens.push((match[1] ?? match[2] ?? match[3]).replace(/\\(["\\])/g, "$1"));
  return tokens;
}

const IGNORED_WITH_VALUE = new Set(["-A", "--user-agent", "-e", "--referer", "--connect-timeout", "--retry", "--retry-delay", "--resolve", "--cert", "--key", "--cacert", "--interface", "--output", "-o"]);

export function parseCurlWithWarnings(source: string): CurlImportResult {
  const tokens = shellTokens(source.trim());
  if (!["curl", "curl.exe"].includes(tokens[0]?.toLowerCase())) throw new Error("\u8bf7\u8f93\u5165\u4ee5 curl \u5f00\u5934\u7684\u547d\u4ee4");
  let method = "GET", url = "", body: string | undefined, timeoutMs = 30000;
  let followRedirects = false, tlsVerify = true, proxy: string | null = null, basicUser = "", cookie = "", forceGet = false;
  const headers: Array<[string, string]> = [], warnings: string[] = [], dataParts: string[] = [], formParts: string[] = [];
  const takeValue = (index: number, option: string) => { const value = tokens[index + 1]; if (value === undefined || value.startsWith("-")) warnings.push(`${option} \u7f3a\u5c11\u53c2\u6570\u503c`); return value ?? ""; };
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "-X" || token === "--request") method = takeValue(index++, token).toUpperCase() || "GET";
    else if (token === "--url") url = takeValue(index++, token);
    else if (token === "-H" || token === "--header") { const value = takeValue(index++, token); const split = value.indexOf(":"); if (split > 0) { const name = value.slice(0, split).trim(); if (isSensitiveHeaderName(name)) warnings.push(`为避免保存明文凭据，${name} Header 未导入；请在调试页绑定 Secret Ref`); else headers.push([name, value.slice(split + 1).trim()]); } else warnings.push(`\u65e0\u6cd5\u8bc6\u522b Header\uff1a${value || "\u7a7a\u503c"}`); }
    else if (["-d", "--data", "--data-raw", "--data-binary", "--data-ascii"].includes(token)) { const value = takeValue(index++, token); dataParts.push(value); if (value.startsWith("@")) warnings.push(`${token} \u7684\u6587\u4ef6\u5f15\u7528\u4e0d\u4f1a\u8bfb\u53d6\u672c\u5730\u6587\u4ef6\uff0c\u5df2\u4fdd\u7559\u539f\u503c`); if (method === "GET" && !forceGet) method = "POST"; }
    else if (token === "--data-urlencode") { const value = takeValue(index++, token); const split = value.indexOf("="); dataParts.push(split >= 0 ? `${value.slice(0, split)}=${encodeURIComponent(value.slice(split + 1))}` : encodeURIComponent(value)); if (method === "GET" && !forceGet) method = "POST"; }
    else if (token === "-G" || token === "--get") { method = "GET"; forceGet = true; }
    else if (token === "-u" || token === "--user") basicUser = takeValue(index++, token);
    else if (token === "-b" || token === "--cookie") cookie = takeValue(index++, token);
    else if (["-F", "--form", "--form-string"].includes(token)) { formParts.push(takeValue(index++, token)); if (method === "GET" && !forceGet) method = "POST"; }
    else if (token === "-L" || token === "--location") followRedirects = true;
    else if (token === "-k" || token === "--insecure") tlsVerify = false;
    else if (token === "-x" || token === "--proxy") proxy = takeValue(index++, token) || null;
    else if (token === "--max-time") { const seconds = Number(takeValue(index++, token)); if (Number.isFinite(seconds) && seconds >= 0) timeoutMs = Math.round(seconds * 1000); else warnings.push("--max-time \u4e0d\u662f\u6709\u6548\u6570\u5b57\uff0c\u5df2\u4f7f\u7528\u9ed8\u8ba4\u8d85\u65f6"); }
    else if (["--compressed", "-s", "--silent", "-S", "--show-error"].includes(token)) { /* output-only */ }
    else if (IGNORED_WITH_VALUE.has(token)) { const value = takeValue(index++, token); warnings.push(`\u6682\u4e0d\u652f\u6301 ${token}${value ? ` ${value}` : ""}\uff0c\u5bfc\u5165\u65f6\u5df2\u5ffd\u7565`); }
    else if (token.startsWith("-")) warnings.push(`\u6682\u4e0d\u652f\u6301 ${token}\uff0c\u5bfc\u5165\u65f6\u5df2\u5ffd\u7565`);
    else if (!url) url = token;
    else warnings.push(`\u53d1\u73b0\u989d\u5916\u53c2\u6570 ${token}\uff0c\u5bfc\u5165\u65f6\u5df2\u5ffd\u7565`);
  }
  if (!url) throw new Error("cURL \u547d\u4ee4\u4e2d\u6ca1\u6709\u627e\u5230 URL");
  if (dataParts.length) { const data = dataParts.join("&"); if (method === "GET") url += `${url.includes("?") ? "&" : "?"}${data}`; else body = data; }
  if (cookie) warnings.push("为避免保存明文凭据，Cookie 未导入；请在调试页绑定 Secret Ref");
  if (basicUser) warnings.push(basicUser.includes(":") ? "\u4e3a\u907f\u514d\u4fdd\u5b58\u660e\u6587\u5bc6\u7801\uff0cBasic Auth \u5bc6\u7801\u672a\u5bfc\u5165\uff1b\u8bf7\u5728\u8c03\u8bd5\u9875\u7ed1\u5b9a Secret Ref" : "Basic Auth \u672a\u5305\u542b\u5bc6\u7801\uff0c\u8bf7\u5728\u8c03\u8bd5\u9875\u7ed1\u5b9a Secret Ref");
  if (formParts.length) warnings.push(`\u68c0\u6d4b\u5230 ${formParts.length} \u4e2a form-data \u5b57\u6bb5\uff1b\u6587\u4ef6\u5b57\u6bb5\u9700\u5bfc\u5165\u540e\u91cd\u65b0\u9009\u62e9\u6587\u4ef6`);
  const request: HttpWorkbenchRequest = { name: (() => { try { return new URL(url).pathname || "/"; } catch { return "\u672a\u547d\u540d\u63a5\u53e3"; } })(), method, url, headers, body, timeoutMs, variables: {}, assertions: [], auth: basicUser ? { kind: "basic", username: basicUser.split(":", 1)[0], secret_ref: null } : null, followRedirects, retryMax: 0, retryBackoffMs: 250, proxy, tlsVerify };
  return { request, warnings: [...new Set(warnings)] };
}

export function parseCurl(source: string): HttpWorkbenchRequest { return parseCurlWithWarnings(source).request; }
