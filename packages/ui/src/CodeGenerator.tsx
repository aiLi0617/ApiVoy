import { useMemo, useState, type CSSProperties } from "react";
import type { HttpWorkbenchRequest } from "./HttpWorkbench";
import { useI18n } from "./i18n";
import { CodeEditor } from "./CodeEditor";

export type CodeLanguage = "curl" | "curl-windows" | "httpie" | "wget" | "powershell" | "javascript" | "java" | "swift" | "go" | "php" | "python" | "http" | "c" | "csharp" | "objective-c" | "ruby" | "ocaml" | "dart" | "r";
export interface HttpCodeTemplate { id: string; label: string; generate: (request: HttpWorkbenchRequest) => string }

const pluginTemplates = new Map<string, HttpCodeTemplate>();
export function registerHttpCodeTemplate(template: HttpCodeTemplate): () => void {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(template.id)) throw new Error(`无效的 HTTP 代码模板 ID：${template.id}`);
  if (pluginTemplates.has(template.id) || ["curl", "curl-windows", "httpie", "wget", "powershell", "javascript", "java", "swift", "go", "php", "python", "http", "c", "csharp", "objective-c", "ruby", "ocaml", "dart", "r"].includes(template.id)) throw new Error(`HTTP 代码模板已存在：${template.id}`);
  pluginTemplates.set(template.id, template);
  return () => { if (pluginTemplates.get(template.id)?.generate === template.generate) pluginTemplates.delete(template.id); };
}
export function listHttpCodeTemplates(): HttpCodeTemplate[] { return [...pluginTemplates.values()]; }

function quoted(value: string): string { return JSON.stringify(value); }
function headerObject(headers: Array<[string, string]>): string { return JSON.stringify(Object.fromEntries(headers), null, 2); }
function normalizeGeneratedBody(body: string, headers: Array<[string, string]>): string {
  const trimmed = body.trim();
  if (!trimmed) return body;
  const contentType = headers.find(([name]) => name.trim().toLowerCase() === "content-type")?.[1].toLowerCase() ?? "";
  const mayBeJson = contentType.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[");
  if (!mayBeJson) return body;
  try {
    return JSON.stringify(JSON.parse(trimmed));
  } catch {
    return body;
  }
}

export function generateHttpCode(request: HttpWorkbenchRequest, language: CodeLanguage | string): string {
  const plugin = pluginTemplates.get(language);
  if (plugin) return plugin.generate(request);
  const method = request.method.toUpperCase();
  const headers = request.headers;
  const body = normalizeGeneratedBody(request.body ?? "", headers);
  if (language === "curl") {
    const lines = [`curl --location --request ${method} ${quoted(request.url)}`];
    for (const [name, value] of headers) lines.push(`  --header ${quoted(`${name}: ${value}`)}`);
    if (body) lines.push(`  --data-raw ${quoted(body)}`);
    for (const part of request.multipart ?? []) lines.push(`  --form ${quoted(part.fileName ? `${part.name}=@${part.fileName}` : `${part.name}=${part.value}`)}`);
    return lines.join(" \\\n");
  }
  if (language === "curl-windows") {
    const lines = [`curl.exe --location --request ${method} ${quoted(request.url)}`];
    for (const [name, value] of headers) lines.push(`  --header ${quoted(`${name}: ${value}`)}`);
    if (body) lines.push(`  --data-raw ${quoted(body)}`);
    for (const part of request.multipart ?? []) lines.push(`  --form ${quoted(part.fileName ? `${part.name}=@${part.fileName}` : `${part.name}=${part.value}`)}`);
    return lines.join(" ^\n");
  }
  if (language === "httpie") {
    const lines = [`http ${method} ${quoted(request.url)}`];
    for (const [name, value] of headers) lines.push(`  ${quoted(`${name}:${value}`)}`);
    if (body) lines.push(`  <<< ${quoted(body)}`);
    return lines.join(" \\\n");
  }
  if (language === "wget") return ["wget", `--method=${method}`, ...headers.map(([name, value]) => `--header=${quoted(`${name}: ${value}`)}`), ...(body ? [`--body-data=${quoted(body)}`] : []), "-O -", quoted(request.url)].join(" \\\n  ");
  if (language === "powershell") {
    const headerLines = headers.map(([name, value]) => `  ${quoted(name)} = ${quoted(value)}`).join("\n");
    const invokeLines = [
      `Invoke-WebRequest -Uri ${quoted(request.url)}`,
      `  -Method ${quoted(method)}`,
      ...(headers.length ? ["  -Headers $headers"] : []),
      ...(body ? [`  -Body ${quoted(body)}`] : []),
    ];
    const command = invokeLines.join(" `\n");
    return `${headers.length ? `$headers = @{\n${headerLines}\n}\n\n` : ""}$response = ${command}\n\n$response.Content`;
  }
  if (language === "javascript") return `const response = await fetch(${quoted(request.url)}, {\n  method: ${quoted(method)},\n  headers: ${headerObject(headers)},${body ? `\n  body: ${quoted(body)},` : ""}\n});\nconsole.log(await response.text());`;
  if (language === "swift") return `import Foundation\n\nvar request = URLRequest(url: URL(string: ${quoted(request.url)})!)\nrequest.httpMethod = ${quoted(method)}\n${headers.map(([name, value]) => `request.setValue(${quoted(value)}, forHTTPHeaderField: ${quoted(name)})`).join("\n")}${body ? `\nrequest.httpBody = ${quoted(body)}.data(using: .utf8)` : ""}\n\nlet (data, response) = try await URLSession.shared.data(for: request)\nprint(String(data: data, encoding: .utf8) ?? "")`;
  if (language === "python") return `import requests\n\nresponse = requests.request(\n    ${quoted(method)},\n    ${quoted(request.url)},\n    headers=${JSON.stringify(Object.fromEntries(headers))},${body ? `\n    data=${quoted(body)},` : ""}\n)\nprint(response.text)`;
  if (language === "go") return `package main\n\nimport (\n  "fmt"\n  "io"\n  "net/http"\n  "strings"\n)\n\nfunc main() {\n  req, _ := http.NewRequest(${quoted(method)}, ${quoted(request.url)}, strings.NewReader(${quoted(body)}))\n${headers.map(([name, value]) => `  req.Header.Set(${quoted(name)}, ${quoted(value)})`).join("\n")}\n  resp, err := http.DefaultClient.Do(req)\n  if err != nil { panic(err) }\n  defer resp.Body.Close()\n  data, _ := io.ReadAll(resp.Body)\n  fmt.Println(string(data))\n}`;
  if (language === "php") return `<?php\n$ch = curl_init(${quoted(request.url)});\ncurl_setopt_array($ch, [\n  CURLOPT_CUSTOMREQUEST => ${quoted(method)},\n  CURLOPT_RETURNTRANSFER => true,\n  CURLOPT_HTTPHEADER => ${JSON.stringify(headers.map(([name, value]) => `${name}: ${value}`))},${body ? `\n  CURLOPT_POSTFIELDS => ${quoted(body)},` : ""}\n]);\necho curl_exec($ch);\ncurl_close($ch);`;
  if (language === "http") return `${method} ${request.url} HTTP/1.1\n${headers.map(([name, value]) => `${name}: ${value}`).join("\n")}${body ? `\n\n${body}` : ""}`;
  if (language === "c") return `#include <curl/curl.h>\n\nint main(void) {\n  CURL *curl = curl_easy_init();\n  struct curl_slist *headers = NULL;\n${headers.map(([name, value]) => `  headers = curl_slist_append(headers, ${quoted(`${name}: ${value}`)});`).join("\n")}\n  curl_easy_setopt(curl, CURLOPT_URL, ${quoted(request.url)});\n  curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, ${quoted(method)});\n  curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);${body ? `\n  curl_easy_setopt(curl, CURLOPT_POSTFIELDS, ${quoted(body)});` : ""}\n  curl_easy_perform(curl);\n  curl_slist_free_all(headers);\n  curl_easy_cleanup(curl);\n}`;
  if (language === "csharp") return `using System.Net.Http;\n\nusing var client = new HttpClient();\nusing var request = new HttpRequestMessage(new HttpMethod(${quoted(method)}), ${quoted(request.url)});\n${headers.map(([name, value]) => `request.Headers.TryAddWithoutValidation(${quoted(name)}, ${quoted(value)});`).join("\n")}${body ? `\nrequest.Content = new StringContent(${quoted(body)});` : ""}\nvar response = await client.SendAsync(request);\nConsole.WriteLine(await response.Content.ReadAsStringAsync());`;
  if (language === "objective-c") return `NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:@${quoted(request.url)}]];\nrequest.HTTPMethod = @${quoted(method)};\n${headers.map(([name, value]) => `[request setValue:@${quoted(value)} forHTTPHeaderField:@${quoted(name)}];`).join("\n")}${body ? `\nrequest.HTTPBody = [@${quoted(body)} dataUsingEncoding:NSUTF8StringEncoding];` : ""}\n[[NSURLSession.sharedSession dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {\n  NSLog(@"%@", [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]);\n}] resume];`;
  if (language === "ruby") return `require 'net/http'\nrequire 'uri'\n\nuri = URI(${quoted(request.url)})\nrequest = Net::HTTPGenericRequest.new(${quoted(method)}, ${body ? "true" : "false"}, true, uri.request_uri)\n${headers.map(([name, value]) => `request[${quoted(name)}] = ${quoted(value)}`).join("\n")}${body ? `\nrequest.body = ${quoted(body)}` : ""}\nresponse = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == 'https') { |http| http.request(request) }\nputs response.body`;
  if (language === "ocaml") return `open Lwt.Infix\n\nlet () =\n  let headers = Cohttp.Header.of_list ${JSON.stringify(headers)} in\n  let body = Cohttp_lwt.Body.of_string ${quoted(body)} in\n  Cohttp_lwt_unix.Client.call ~headers ~body \`${method} (Uri.of_string ${quoted(request.url)}) >>= fun (_, body) ->\n  Cohttp_lwt.Body.to_string body >|= print_endline\n  |> Lwt_main.run`;
  if (language === "dart") return `import 'package:http/http.dart' as http;\n\nFuture<void> main() async {\n  final request = http.Request(${quoted(method)}, Uri.parse(${quoted(request.url)}));\n  request.headers.addAll(${headerObject(headers)});${body ? `\n  request.body = ${quoted(body)};` : ""}\n  final response = await request.send();\n  print(await response.stream.bytesToString());\n}`;
  if (language === "r") return `library(httr2)\n\nrequest(${quoted(request.url)}) |>${headers.length ? `\n  req_headers(${headers.map(([name, value]) => `${JSON.stringify(name)} = ${quoted(value)}`).join(", ")}) |>` : ""}\n  req_method(${quoted(method)})${body ? ` |>\n  req_body_raw(${quoted(body)})` : ""} |>\n  req_perform() |>\n  resp_body_string()`;
  return `import java.net.URI;\nimport java.net.http.*;\n\nvar request = HttpRequest.newBuilder(URI.create(${quoted(request.url)}))${headers.map(([name, value]) => `\n    .header(${quoted(name)}, ${quoted(value)})`).join("")}\n    .method(${quoted(method)}, HttpRequest.BodyPublishers.${body ? `ofString(${quoted(body)})` : "noBody()"})\n    .build();\nvar response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());\nSystem.out.println(response.body());`;
}

const BUILTIN_GROUPS = [
  { id: "shell", label: "Shell", variants: [{ id: "curl", label: "cURL" }, { id: "curl-windows", label: "cURL-Windows" }, { id: "httpie", label: "HTTPie" }, { id: "wget", label: "wget" }, { id: "powershell", label: "PowerShell" }] },
  { id: "javascript", label: "JavaScript", variants: [{ id: "javascript", label: "Fetch" }] },
  { id: "java", label: "Java", variants: [{ id: "java", label: "HttpClient" }] },
  { id: "swift", label: "Swift", variants: [{ id: "swift", label: "URLSession" }] },
  { id: "go", label: "Go", variants: [{ id: "go", label: "net/http" }] },
  { id: "php", label: "PHP", variants: [{ id: "php", label: "cURL" }] },
  { id: "python", label: "Python", variants: [{ id: "python", label: "Requests" }] },
  { id: "http", label: "HTTP", variants: [{ id: "http", label: "Raw HTTP" }] },
  { id: "c", label: "C", variants: [{ id: "c", label: "libcurl" }] },
  { id: "csharp", label: "C#", variants: [{ id: "csharp", label: "HttpClient" }] },
  { id: "objective-c", label: "Objective-C", variants: [{ id: "objective-c", label: "NSURLSession" }] },
  { id: "ruby", label: "Ruby", variants: [{ id: "ruby", label: "Net::HTTP" }] },
  { id: "ocaml", label: "OCaml", variants: [{ id: "ocaml", label: "Cohttp" }] },
  { id: "dart", label: "Dart", variants: [{ id: "dart", label: "http" }] },
  { id: "r", label: "R", variants: [{ id: "r", label: "httr2" }] },
] as const;

const VIEWER_LANGUAGE: Record<string, string> = { curl:"shell", "curl-windows":"bat", httpie:"shell", wget:"shell", powershell:"powershell", javascript:"javascript", java:"java", swift:"swift", go:"go", php:"php", python:"python", http:"http", c:"c", csharp:"csharp", "objective-c":"objective-c", ruby:"ruby", ocaml:"plaintext", dart:"dart", r:"r" };

export interface CodeGeneratorGroup { id: string; label: string; variants: Array<{ id: string; label: string }> }
export interface CodeGeneratorViewProps { groups: CodeGeneratorGroup[]; selected: string; onSelect: (id: string) => void; code: string; editorLanguage: string }

export function CodeGeneratorView({ groups, selected, onSelect, code, editorLanguage }: CodeGeneratorViewProps) {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const activeGroup = groups.find((group) => group.variants.some((variant) => variant.id === selected)) ?? groups[0];
  const editorHeight = useMemo(() => Math.min(900, Math.max(440, code.split("\n").length * 19 + 32)), [code]);
  return <div style={styles.root} className="http-code-generator">
    <div style={styles.heading}><strong>请求代码</strong><button style={styles.copy} onClick={async () => { await navigator.clipboard.writeText(code); setMessage("已复制"); }}>{message || t("action.copy")}</button></div>
    <div style={styles.languageTabs} role="tablist" aria-label="代码语言">
      {groups.map((group) => <button key={group.id} type="button" role="tab" aria-selected={activeGroup?.id === group.id} style={activeGroup?.id === group.id ? styles.languageActive : styles.languageTab} onClick={() => { onSelect(group.variants[0].id); setMessage(""); }}>{group.label}</button>)}
    </div>
    {activeGroup && <div style={styles.variantTabs} role="tablist" aria-label={`${activeGroup.label} 客户端`}>
      {activeGroup.variants.map((variant) => <button key={variant.id} type="button" role="tab" aria-selected={selected === variant.id} style={selected === variant.id ? styles.variantActive : styles.variantTab} onClick={() => { onSelect(variant.id); setMessage(""); }}>{variant.label}</button>)}
    </div>}
    <CodeEditor value={code} onChange={() => {}} language={editorLanguage} height={editorHeight} readOnly bare wordWrap={false}/>
  </div>;
}

export function CodeGenerator({ request }: { request: HttpWorkbenchRequest }) {
  const { t } = useI18n();
  const [language, setLanguage] = useState<string>("curl");
  const code = useMemo(() => generateHttpCode(request, language), [request, language]);
  const pluginVariants = listHttpCodeTemplates().map((template) => ({ id: template.id, label: template.label }));
  const groups = pluginVariants.length ? [...BUILTIN_GROUPS, { id: "plugin", label: t("codegen.plugin"), variants: pluginVariants }] : BUILTIN_GROUPS;
  return <CodeGeneratorView groups={groups.map((group) => ({ ...group, variants: [...group.variants] }))} selected={language} onSelect={setLanguage} code={code} editorLanguage={VIEWER_LANGUAGE[language] ?? "plaintext"}/>;
}

const styles: Record<string, CSSProperties> = {
  root: { marginTop: 10, border: "1px solid var(--apivoy-border)", borderRadius: 8, overflow: "hidden", background: "var(--apivoy-bg)" },
  heading: { minHeight: 42, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "0 12px", color: "var(--apivoy-text)" },
  copy: { border: 0, background: "transparent", color: "var(--apivoy-muted)", padding: "5px 8px", fontSize: 11 },
  languageTabs: { display: "flex", gap: 2, overflowX: "auto", padding: "0 10px", borderBottom: "1px solid var(--apivoy-border)" },
  languageTab: { flex: "0 0 auto", border: 0, borderBottom: "2px solid transparent", borderRadius: 0, background: "transparent", color: "var(--apivoy-muted)", padding: "9px 10px", fontSize: 12 },
  languageActive: { flex: "0 0 auto", border: 0, borderBottom: "2px solid var(--apivoy-accent)", borderRadius: 0, background: "transparent", color: "var(--apivoy-accent)", padding: "9px 10px", fontSize: 12, fontWeight: 700 },
  variantTabs: { minHeight: 40, display: "flex", alignItems: "center", gap: 5, overflowX: "auto", padding: "5px 12px", borderBottom: "1px solid var(--apivoy-border)" },
  variantTab: { flex: "0 0 auto", border: 0, background: "transparent", color: "var(--apivoy-muted)", padding: "6px 9px", fontSize: 11 },
  variantActive: { flex: "0 0 auto", border: 0, background: "var(--apivoy-bg-elevated)", color: "var(--apivoy-text)", padding: "6px 9px", fontSize: 11 },
};
