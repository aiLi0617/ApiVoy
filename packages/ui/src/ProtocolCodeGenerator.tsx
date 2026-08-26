import { useMemo, useState } from "react";
import type { GraphqlWorkbenchRequest } from "./GraphqlWorkbench";
import type { GrpcWorkbenchRequest } from "./GrpcWorkbench";
import type { SocketWorkbenchRequest } from "./SocketWorkbench";
import type { SseWorkbenchRequest } from "./SseWorkbench";
import type { WebSocketWorkbenchRequest } from "./WebSocketWorkbench";
import { CodeGeneratorView, type CodeGeneratorGroup } from "./CodeGenerator";

export type CodegenProtocol = "graphql" | "grpc" | "websocket" | "sse" | "tcp" | "udp";
export type ProtocolCodegenInput =
  | { protocol: "graphql"; request: GraphqlWorkbenchRequest }
  | { protocol: "grpc"; request: GrpcWorkbenchRequest }
  | { protocol: "websocket"; request: WebSocketWorkbenchRequest }
  | { protocol: "sse"; request: SseWorkbenchRequest }
  | { protocol: "tcp" | "udp"; request: SocketWorkbenchRequest };

export interface CodeTemplate {
  id: string;
  label: string;
  protocols: CodegenProtocol[];
  generate: (input: ProtocolCodegenInput) => string;
  source?: "builtin" | "plugin";
}

const templates = new Map<string, CodeTemplate>();
const quote = (value: string) => JSON.stringify(value);
const headers = (values: Array<[string, string]>) => values.flatMap(([name, value]) => ["-H", quote(`${name}: ${value}`)]).join(" ");
const phpAssoc = (values: Array<[string, string]>) => `[${values.map(([name, value]) => `${quote(name)} => ${quote(value)}`).join(", ")}]`;
const rNamedVector = (values: Array<[string, string]>) => `c(${values.map(([name, value]) => `${quote(name)} = ${quote(value)}`).join(", ")})`;

export function registerCodeTemplate(template: CodeTemplate): () => void {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(template.id)) throw new Error(`无效的代码模板 ID：${template.id}`);
  if (templates.has(template.id)) throw new Error(`代码模板已存在：${template.id}`);
  templates.set(template.id, { ...template, protocols: [...template.protocols] });
  return () => { if (templates.get(template.id)?.generate === template.generate) templates.delete(template.id); };
}

export function listCodeTemplates(protocol: CodegenProtocol): CodeTemplate[] {
  return [...templates.values()].filter((template) => template.protocols.includes(protocol));
}

export function generateProtocolCode(input: ProtocolCodegenInput, templateId: string): string {
  const template = templates.get(templateId);
  if (!template || !template.protocols.includes(input.protocol)) throw new Error(`协议 ${input.protocol} 不支持模板 ${templateId}`);
  return template.generate(input);
}

function builtin(template: Omit<CodeTemplate, "source">) { registerCodeTemplate({ ...template, source: "builtin" }); }

builtin({ id: "graphql.curl", label: "GraphQL · cURL", protocols: ["graphql"], generate: (input) => {
  if (input.protocol !== "graphql") return "";
  const payload = JSON.stringify({ query: input.request.query, variables: input.request.variables, operationName: input.request.operationName });
  return `curl ${quote(input.request.url)} -H "Content-Type: application/json" ${headers(input.request.headers)} --data-raw ${quote(payload)}`;
} });
builtin({ id: "graphql.fetch", label: "GraphQL · Fetch", protocols: ["graphql"], generate: (input) => input.protocol === "graphql" ? `const response = await fetch(${quote(input.request.url)}, {\n  method: "POST",\n  headers: ${JSON.stringify(Object.fromEntries(input.request.headers), null, 2)},\n  body: JSON.stringify(${JSON.stringify({ query: input.request.query, variables: input.request.variables, operationName: input.request.operationName }, null, 2)})\n});\nconsole.log(await response.json());` : "" });
builtin({ id: "grpc.grpcurl", label: "gRPC · grpcurl", protocols: ["grpc"], generate: (input) => input.protocol === "grpc" ? `grpcurl ${input.request.metadata.flatMap(([name, value]) => ["-H", quote(`${name}: ${value}`)]).join(" ")} -d ${quote(input.request.messageJson || "{}") } ${quote(input.request.target.replace(/^https?:\/\//, ""))} ${quote(`${input.request.service}/${input.request.method}`)}` : "" });
builtin({ id: "websocket.javascript", label: "WebSocket · JavaScript", protocols: ["websocket"], generate: (input) => input.protocol === "websocket" ? `const socket = new WebSocket(${quote(input.request.url)}, ${JSON.stringify(input.request.subprotocols)});\nsocket.onmessage = ({data}) => console.log(data);\nsocket.onopen = () => socket.send(${quote(input.request.messages[0]?.data ?? "")});` : "" });
builtin({ id: "websocket.node-ws", label: "WebSocket · ws", protocols: ["websocket"], generate: (input) => input.protocol === "websocket" ? `import WebSocket from "ws";\n\nconst socket = new WebSocket(${quote(input.request.url)}, ${JSON.stringify(input.request.subprotocols)}, {\n  headers: ${JSON.stringify(Object.fromEntries(input.request.headers), null, 2)}\n});\nsocket.on("open", () => socket.send(${quote(input.request.messages[0]?.data ?? "")}));\nsocket.on("message", (data) => console.log(data.toString()));\nsocket.on("error", console.error);` : "" });
builtin({ id: "websocket.python", label: "WebSocket · websockets", protocols: ["websocket"], generate: (input) => input.protocol === "websocket" ? `import asyncio\nimport websockets\n\nasync def main():\n    async with websockets.connect(\n        ${quote(input.request.url)},\n        subprotocols=${JSON.stringify(input.request.subprotocols)},\n        additional_headers=${JSON.stringify(Object.fromEntries(input.request.headers))},\n    ) as socket:\n        await socket.send(${quote(input.request.messages[0]?.data ?? "")})\n        print(await socket.recv())\n\nasyncio.run(main())` : "" });
builtin({ id: "websocket.java", label: "WebSocket · HttpClient", protocols: ["websocket"], generate: (input) => input.protocol === "websocket" ? `import java.net.URI;\nimport java.net.http.*;\nimport java.util.concurrent.CompletionStage;\n\nvar builder = HttpClient.newHttpClient().newWebSocketBuilder();\n${input.request.headers.map(([name, value]) => `builder.header(${quote(name)}, ${quote(value)});`).join("\n")}\n${input.request.subprotocols.length ? `builder.subprotocols(${input.request.subprotocols.map(quote).join(", ")});` : ""}\nvar socket = builder.buildAsync(URI.create(${quote(input.request.url)}), new WebSocket.Listener() {\n  public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {\n    System.out.println(data); return WebSocket.Listener.super.onText(ws, data, last);\n  }\n}).join();\nsocket.sendText(${quote(input.request.messages[0]?.data ?? "")}, true).join();` : "" });
builtin({ id: "websocket.go", label: "WebSocket · gorilla/websocket", protocols: ["websocket"], generate: (input) => input.protocol === "websocket" ? `package main\n\nimport (\n  "fmt"\n  "net/http"\n  "github.com/gorilla/websocket"\n)\n\nfunc main() {\n  headers := http.Header{}\n${input.request.headers.map(([name, value]) => `  headers.Add(${quote(name)}, ${quote(value)})`).join("\n")}\n  dialer := websocket.Dialer{Subprotocols: []string{${input.request.subprotocols.map(quote).join(", ")}}}\n  conn, _, err := dialer.Dial(${quote(input.request.url)}, headers)\n  if err != nil { panic(err) }\n  defer conn.Close()\n  if err = conn.WriteMessage(websocket.TextMessage, []byte(${quote(input.request.messages[0]?.data ?? "")})); err != nil { panic(err) }\n  _, message, err := conn.ReadMessage()\n  if err != nil { panic(err) }\n  fmt.Println(string(message))\n}` : "" });
builtin({ id: "websocket.csharp", label: "WebSocket · ClientWebSocket", protocols: ["websocket"], generate: (input) => input.protocol === "websocket" ? `using System.Net.WebSockets;\nusing System.Text;\n\nusing var socket = new ClientWebSocket();\n${input.request.headers.map(([name, value]) => `socket.Options.SetRequestHeader(${quote(name)}, ${quote(value)});`).join("\n")}\n${input.request.subprotocols.map((protocol) => `socket.Options.AddSubProtocol(${quote(protocol)});`).join("\n")}\nawait socket.ConnectAsync(new Uri(${quote(input.request.url)}), CancellationToken.None);\nvar outgoing = Encoding.UTF8.GetBytes(${quote(input.request.messages[0]?.data ?? "")});\nawait socket.SendAsync(outgoing, WebSocketMessageType.Text, true, CancellationToken.None);\nvar buffer = new byte[8192];\nvar result = await socket.ReceiveAsync(buffer, CancellationToken.None);\nConsole.WriteLine(Encoding.UTF8.GetString(buffer, 0, result.Count));` : "" });
builtin({ id: "websocket.swift", label: "WebSocket · URLSession", protocols: ["websocket"], generate: (input) => input.protocol === "websocket" ? `import Foundation\n\nvar request = URLRequest(url: URL(string: ${quote(input.request.url)})!)\n${input.request.headers.map(([name, value]) => `request.setValue(${quote(value)}, forHTTPHeaderField: ${quote(name)})`).join("\n")}\n${input.request.subprotocols.length ? `request.setValue(${quote(input.request.subprotocols.join(", "))}, forHTTPHeaderField: "Sec-WebSocket-Protocol")` : ""}\nlet socket = URLSession.shared.webSocketTask(with: request)\nsocket.resume()\nsocket.send(.string(${quote(input.request.messages[0]?.data ?? "")})) { if let error = $0 { print(error) } }\nsocket.receive { result in print(result) }` : "" });
builtin({ id: "websocket.websocat", label: "WebSocket · websocat", protocols: ["websocket"], generate: (input) => input.protocol === "websocket" ? `printf %s ${quote(input.request.messages[0]?.data ?? "")} | websocat ${input.request.headers.map(([name, value]) => `-H=${quote(`${name}: ${value}`)}`).join(" ")} ${input.request.subprotocols.map((protocol) => `--protocol ${quote(protocol)}`).join(" ")} ${quote(input.request.url)}` : "" });
builtin({ id: "websocket.wscat", label: "WebSocket · wscat", protocols: ["websocket"], generate: (input) => input.protocol === "websocket" ? `wscat -c ${quote(input.request.url)} ${input.request.headers.map(([name, value]) => `-H ${quote(`${name}: ${value}`)}`).join(" ")} ${input.request.subprotocols.map((protocol) => `-s ${quote(protocol)}`).join(" ")} -x ${quote(input.request.messages[0]?.data ?? "")}` : "" });
builtin({ id: "websocket.php", label: "WebSocket · Pawl", protocols: ["websocket"], generate: (input) => input.protocol === "websocket" ? `<?php\nrequire __DIR__ . '/vendor/autoload.php';\n\n\\Ratchet\\Client\\connect(${quote(input.request.url)}, ${JSON.stringify(input.request.subprotocols)}, ${phpAssoc(input.request.headers)})->then(function ($socket) {\n    $socket->on('message', fn($message) => print($message . PHP_EOL));\n    $socket->send(${quote(input.request.messages[0]?.data ?? "")});\n}, fn($error) => print($error->getMessage() . PHP_EOL));` : "" });
builtin({ id: "websocket.ruby", label: "WebSocket · websocket-client-simple", protocols: ["websocket"], generate: (input) => input.protocol === "websocket" ? `require 'websocket-client-simple'\n\nsocket = WebSocket::Client::Simple.connect(${quote(input.request.url)}, headers: ${JSON.stringify(Object.fromEntries(input.request.headers))})\nsocket.on(:message) { |event| puts event.data }\nsocket.on(:open) { socket.send(${quote(input.request.messages[0]?.data ?? "")}) }\nloop { sleep 1 }` : "" });
builtin({ id: "websocket.dart", label: "WebSocket · web_socket_channel", protocols: ["websocket"], generate: (input) => input.protocol === "websocket" ? `import 'package:web_socket_channel/io.dart';\n\nvoid main() {\n  final channel = IOWebSocketChannel.connect(\n    Uri.parse(${quote(input.request.url)}),\n    protocols: ${JSON.stringify(input.request.subprotocols)},\n    headers: ${JSON.stringify(Object.fromEntries(input.request.headers))},\n  );\n  channel.stream.listen(print);\n  channel.sink.add(${quote(input.request.messages[0]?.data ?? "")});\n}` : "" });
builtin({ id: "websocket.objective-c", label: "WebSocket · NSURLSession", protocols: ["websocket"], generate: (input) => input.protocol === "websocket" ? `NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:@${quote(input.request.url)}]];\n${input.request.headers.map(([name, value]) => `[request setValue:@${quote(value)} forHTTPHeaderField:@${quote(name)}];`).join("\n")}\nNSURLSessionWebSocketTask *socket = [NSURLSession.sharedSession webSocketTaskWithRequest:request];\n[socket resume];\n[socket sendMessage:[[NSURLSessionWebSocketMessage alloc] initWithString:@${quote(input.request.messages[0]?.data ?? "")}] completionHandler:^(NSError *error) { if (error) NSLog(@"%@", error); }];` : "" });
builtin({ id: "websocket.rust", label: "WebSocket · tokio-tungstenite", protocols: ["websocket"], generate: (input) => input.protocol === "websocket" ? `use futures_util::{SinkExt, StreamExt};\nuse tokio_tungstenite::{connect_async, tungstenite::{client::IntoClientRequest, Message}};\n\n#[tokio::main]\nasync fn main() -> Result<(), Box<dyn std::error::Error>> {\n    let mut request = ${quote(input.request.url)}.into_client_request()?;\n${input.request.headers.map(([name, value]) => `    request.headers_mut().insert(${quote(name)}, ${quote(value)}.parse()?);`).join("\n")}\n    let (mut socket, _) = connect_async(request).await?;\n    socket.send(Message::Text(${quote(input.request.messages[0]?.data ?? "")}.into())).await?;\n    if let Some(message) = socket.next().await { println!("{}", message?); }\n    Ok(())\n}` : "" });
builtin({ id: "websocket.r", label: "WebSocket · websocket", protocols: ["websocket"], generate: (input) => input.protocol === "websocket" ? `library(websocket)\n\nws <- WebSocket$new(${quote(input.request.url)}, headers = ${rNamedVector(input.request.headers)})\nws$onOpen(function(event) ws$send(${quote(input.request.messages[0]?.data ?? "")}))\nws$onMessage(function(event) print(event$data))\nlater::run_now(Inf)` : "" });
builtin({ id: "websocket.kotlin", label: "WebSocket · OkHttp", protocols: ["websocket"], generate: (input) => input.protocol === "websocket" ? `import okhttp3.*\n\nval client = OkHttpClient()\nval request = Request.Builder().url(${quote(input.request.url)})${input.request.headers.map(([name, value]) => `.addHeader(${quote(name)}, ${quote(value)})`).join("")}.build()\nclient.newWebSocket(request, object : WebSocketListener() {\n  override fun onOpen(socket: WebSocket, response: Response) { socket.send(${quote(input.request.messages[0]?.data ?? "")}) }\n  override fun onMessage(socket: WebSocket, text: String) { println(text) }\n})` : "" });
builtin({ id: "sse.curl", label: "SSE · cURL", protocols: ["sse"], generate: (input) => input.protocol === "sse" ? `curl -N -H "Accept: text/event-stream" ${headers(input.request.headers)}${input.request.lastEventId ? ` -H ${quote(`Last-Event-ID: ${input.request.lastEventId}`)}` : ""} ${quote(input.request.url)}` : "" });
builtin({ id: "sse.eventsource", label: "SSE · EventSource", protocols: ["sse"], generate: (input) => input.protocol === "sse" ? `const events = new EventSource(${quote(input.request.url)});\nevents.onmessage = (event) => console.log(event.lastEventId, event.data);\nevents.onerror = console.error;` : "" });
builtin({ id: "tcp.netcat", label: "TCP · netcat", protocols: ["tcp"], generate: (input) => input.protocol === "tcp" ? `printf %s ${quote(input.request.data)} | nc ${input.request.target.replace(":", " ")}` : "" });
builtin({ id: "udp.netcat", label: "UDP · netcat", protocols: ["udp"], generate: (input) => input.protocol === "udp" ? `printf %s ${quote(input.request.data)} | nc -u ${input.request.target.replace(":", " ")}` : "" });

const TEMPLATE_PRESENTATION: Record<string, { groupId: string; groupLabel: string; variantLabel: string; editorLanguage: string }> = {
  "websocket.javascript": { groupId: "javascript", groupLabel: "JavaScript", variantLabel: "WebSocket API", editorLanguage: "javascript" },
  "websocket.node-ws": { groupId: "javascript", groupLabel: "JavaScript", variantLabel: "ws (Node.js)", editorLanguage: "javascript" },
  "websocket.python": { groupId: "python", groupLabel: "Python", variantLabel: "websockets", editorLanguage: "python" },
  "websocket.java": { groupId: "java", groupLabel: "Java", variantLabel: "HttpClient", editorLanguage: "java" },
  "websocket.go": { groupId: "go", groupLabel: "Go", variantLabel: "gorilla/websocket", editorLanguage: "go" },
  "websocket.csharp": { groupId: "csharp", groupLabel: "C#", variantLabel: "ClientWebSocket", editorLanguage: "csharp" },
  "websocket.swift": { groupId: "swift", groupLabel: "Swift", variantLabel: "URLSession", editorLanguage: "swift" },
  "websocket.websocat": { groupId: "shell", groupLabel: "Shell", variantLabel: "websocat", editorLanguage: "shell" },
  "websocket.wscat": { groupId: "shell", groupLabel: "Shell", variantLabel: "wscat", editorLanguage: "shell" },
  "websocket.php": { groupId: "php", groupLabel: "PHP", variantLabel: "Pawl", editorLanguage: "php" },
  "websocket.ruby": { groupId: "ruby", groupLabel: "Ruby", variantLabel: "websocket-client-simple", editorLanguage: "ruby" },
  "websocket.dart": { groupId: "dart", groupLabel: "Dart", variantLabel: "web_socket_channel", editorLanguage: "dart" },
  "websocket.objective-c": { groupId: "objective-c", groupLabel: "Objective-C", variantLabel: "NSURLSession", editorLanguage: "objective-c" },
  "websocket.rust": { groupId: "rust", groupLabel: "Rust", variantLabel: "tokio-tungstenite", editorLanguage: "rust" },
  "websocket.r": { groupId: "r", groupLabel: "R", variantLabel: "websocket", editorLanguage: "r" },
  "websocket.kotlin": { groupId: "kotlin", groupLabel: "Kotlin", variantLabel: "OkHttp", editorLanguage: "kotlin" },
};

export function ProtocolCodeGenerator({ input }: { input: ProtocolCodegenInput }) {
  const options = listCodeTemplates(input.protocol);
  const [selected, setSelected] = useState(options[0]?.id ?? "");
  const active = options.some((option) => option.id === selected) ? selected : options[0]?.id ?? "";
  const code = useMemo(() => active ? generateProtocolCode(input, active) : "暂无可用模板", [input, active]);
  const language = TEMPLATE_PRESENTATION[active]?.editorLanguage ?? (active.endsWith(".javascript") || active.endsWith(".eventsource") ? "javascript" : active.endsWith(".grpcurl") || active.endsWith(".curl") || active.endsWith(".netcat") ? "shell" : "plaintext");
  const groups = options.reduce<CodeGeneratorGroup[]>((result, option) => {
    const presentation = TEMPLATE_PRESENTATION[option.id];
    const groupId = option.source === "plugin" ? "plugin" : presentation?.groupId ?? (option.id.endsWith(".javascript") || option.id.endsWith(".fetch") || option.id.endsWith(".eventsource") ? "javascript" : "shell");
    const groupLabel = option.source === "plugin" ? "插件" : presentation?.groupLabel ?? (groupId === "javascript" ? "JavaScript" : "Shell");
    const variantLabel = presentation?.variantLabel ?? option.label.split(" · ").at(-1) ?? option.label;
    const group = result.find((item) => item.id === groupId);
    if (group) group.variants.push({ id: option.id, label: variantLabel });
    else result.push({ id: groupId, label: groupLabel, variants: [{ id: option.id, label: variantLabel }] });
    return result;
  }, []);
  return <div className="protocol-codegen"><CodeGeneratorView groups={groups} selected={active} onSelect={setSelected} code={code} editorLanguage={language}/></div>;
}
