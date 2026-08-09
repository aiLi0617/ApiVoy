import { useMemo, useState, type CSSProperties } from "react";
import type { HttpWorkbenchRequest } from "./HttpWorkbench";
import { useI18n } from "./i18n";

export type CodeLanguage = "curl" | "javascript" | "python" | "go" | "rust" | "java";
export interface HttpCodeTemplate { id: string; label: string; generate: (request: HttpWorkbenchRequest) => string }

const pluginTemplates = new Map<string, HttpCodeTemplate>();
export function registerHttpCodeTemplate(template: HttpCodeTemplate): () => void {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(template.id)) throw new Error(`无效的 HTTP 代码模板 ID：${template.id}`);
  if (pluginTemplates.has(template.id) || ["curl", "javascript", "python", "go", "rust", "java"].includes(template.id)) throw new Error(`HTTP 代码模板已存在：${template.id}`);
  pluginTemplates.set(template.id, template);
  return () => { if (pluginTemplates.get(template.id)?.generate === template.generate) pluginTemplates.delete(template.id); };
}
export function listHttpCodeTemplates(): HttpCodeTemplate[] { return [...pluginTemplates.values()]; }

function quoted(value: string): string { return JSON.stringify(value); }
function headerObject(headers: Array<[string, string]>): string { return JSON.stringify(Object.fromEntries(headers), null, 2); }

export function generateHttpCode(request: HttpWorkbenchRequest, language: CodeLanguage | string): string {
  const plugin = pluginTemplates.get(language);
  if (plugin) return plugin.generate(request);
  const method = request.method.toUpperCase();
  const body = request.body ?? "";
  const headers = request.headers;
  if (language === "curl") {
    const parts = ["curl", "-X", method, quoted(request.url)];
    for (const [name, value] of headers) parts.push("-H", quoted(`${name}: ${value}`));
    if (body) parts.push("--data-raw", quoted(body));
    for (const part of request.multipart ?? []) parts.push("-F", quoted(part.fileName ? `${part.name}=@${part.fileName}` : `${part.name}=${part.value}`));
    return parts.join(" ");
  }
  if (language === "javascript") return `const response = await fetch(${quoted(request.url)}, {\n  method: ${quoted(method)},\n  headers: ${headerObject(headers)},${body ? `\n  body: ${quoted(body)},` : ""}\n});\nconsole.log(await response.text());`;
  if (language === "python") return `import requests\n\nresponse = requests.request(\n    ${quoted(method)},\n    ${quoted(request.url)},\n    headers=${JSON.stringify(Object.fromEntries(headers))},${body ? `\n    data=${quoted(body)},` : ""}\n)\nprint(response.text)`;
  if (language === "go") return `package main\n\nimport (\n  "fmt"\n  "io"\n  "net/http"\n  "strings"\n)\n\nfunc main() {\n  req, _ := http.NewRequest(${quoted(method)}, ${quoted(request.url)}, strings.NewReader(${quoted(body)}))\n${headers.map(([name, value]) => `  req.Header.Set(${quoted(name)}, ${quoted(value)})`).join("\n")}\n  resp, err := http.DefaultClient.Do(req)\n  if err != nil { panic(err) }\n  defer resp.Body.Close()\n  data, _ := io.ReadAll(resp.Body)\n  fmt.Println(string(data))\n}`;
  if (language === "rust") return `#[tokio::main]\nasync fn main() -> Result<(), reqwest::Error> {\n    let client = reqwest::Client::new();\n    let response = client.request(reqwest::Method::${method}, ${quoted(request.url)})${headers.map(([name, value]) => `\n        .header(${quoted(name)}, ${quoted(value)})`).join("")}${body ? `\n        .body(${quoted(body)})` : ""}\n        .send().await?;\n    println!("{}", response.text().await?);\n    Ok(())\n}`;
  return `import java.net.URI;\nimport java.net.http.*;\n\nvar request = HttpRequest.newBuilder(URI.create(${quoted(request.url)}))${headers.map(([name, value]) => `\n    .header(${quoted(name)}, ${quoted(value)})`).join("")}\n    .method(${quoted(method)}, HttpRequest.BodyPublishers.${body ? `ofString(${quoted(body)})` : "noBody()"})\n    .build();\nvar response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());\nSystem.out.println(response.body());`;
}

export function CodeGenerator({ request }: { request: HttpWorkbenchRequest }) {
  const { t } = useI18n();
  const [language, setLanguage] = useState<string>("curl");
  const [message, setMessage] = useState("");
  const code = useMemo(() => generateHttpCode(request, language), [request, language]);
  return <div style={styles.root}><div style={styles.toolbar}><strong>{t("codegen.title")}</strong><select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="curl">cURL</option><option value="javascript">JavaScript Fetch</option><option value="python">Python Requests</option><option value="go">Go net/http</option><option value="rust">Rust reqwest</option><option value="java">Java HttpClient</option>{listHttpCodeTemplates().map((template) => <option key={template.id} value={template.id}>{template.label} ({t("codegen.plugin")})</option>)}</select><button onClick={async () => { await navigator.clipboard.writeText(code); setMessage("✓"); }}>{t("action.copy")}</button>{message && <small>{message}</small>}</div><pre style={styles.code}>{code}</pre></div>;
}

const styles: Record<string, CSSProperties> = {
  root: { marginTop: 10, border: "1px solid var(--apivoy-border)", borderRadius: 10, overflow: "hidden", background: "#080d13" },
  toolbar: { display: "flex", alignItems: "center", gap: 8, padding: 9, borderBottom: "1px solid var(--apivoy-border)" },
  code: { margin: 0, padding: 12, overflow: "auto", maxHeight: 320, whiteSpace: "pre-wrap", color: "#bfe0ee", fontSize: 12 },
};
