import type { HttpWorkbenchRequest } from "./HttpWorkbench";

function shellTokens(source: string): string[] {
  const tokens: string[] = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source.replace(/\\\r?\n/g, " ")))) tokens.push((match[1] ?? match[2] ?? match[3]).replace(/\\(["\\])/g, "$1"));
  return tokens;
}

export function parseCurl(source: string): HttpWorkbenchRequest {
  const tokens = shellTokens(source.trim());
  if (!["curl", "curl.exe"].includes(tokens[0]?.toLowerCase())) throw new Error("请输入以 curl 开头的命令");
  let method = "GET";
  let url = "";
  let body: string | undefined;
  const headers: Array<[string, string]> = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "-X" || token === "--request") method = (tokens[++index] ?? "GET").toUpperCase();
    else if (token === "-H" || token === "--header") {
      const value = tokens[++index] ?? "";
      const split = value.indexOf(":");
      if (split > 0) headers.push([value.slice(0, split).trim(), value.slice(split + 1).trim()]);
    } else if (["-d", "--data", "--data-raw", "--data-binary"].includes(token)) {
      body = tokens[++index] ?? "";
      if (method === "GET") method = "POST";
    } else if (!token.startsWith("-") && !url) url = token;
  }
  if (!url) throw new Error("cURL 命令中没有找到 URL");
  return {
    name: (() => { try { return new URL(url).pathname || "/"; } catch { return "未命名接口"; } })(),
    method, url, headers, body, timeoutMs: 30000, variables: {}, assertions: [], auth: null,
    followRedirects: true, retryMax: 0, retryBackoffMs: 250, proxy: null, tlsVerify: true,
  };
}
