# ApiVoy 阶段计划与缺口对照

> 基于 PRD V1.1、技术架构 V1.0，以及 2026-08-05 品牌与技术定稿。  
> 对照日期：2026-08-12（代码库现状快照）。

---

## 1. 定稿原则（相对 PRD 的调整）

| 项 | PRD 原文倾向 | 项目定稿 |
|----|--------------|----------|
| 产品名 | 未定 | **ApiVoy**（旧称 Reqonaut；ApiLens 仅为内部代号） |
| 许可证 | 待决策 | Apache-2.0 核心开源；企业云能力闭源 |
| MVP 协作 | F-016 标为 P1 | **团队云同步放 P2**；MVP 仅本地工作区 + Git 友好文件 |
| 脚本引擎 | F-009 标为 P0 | **P0 预留生命周期**；P1 接入 QuickJS，不重构主链路 |
| Desktop / Agent | 待决策 | 共享 crates，**双二进制**，统一版本握手 |
| 插件 | WASM / 原生 Sidecar 并存 | 第三方**仅 WASM**；官方可保留原生适配器 |
| 协作后端 | Java 协作服务 | **P2**：Java 21 + Spring Boot 3 + Gradle Wrapper |

---

## 2. 现状总览

当前仓库已完成 **阶段 0、MVP、P1 与主要 P2 本地/私有化能力**，正在进行发布验证、细粒度国际化与云端执行能力收口。

### 2.1 已具备（可运行骨架）

| 能力 | 证据 / 说明 |
|------|-------------|
| Monorepo + ApiVoy 命名 | `apps/`、`crates/`、`packages/`、Apache-2.0 |
| 统一域模型 | `crates/core-domain`：`RequestEnvelope`、`ExecutionEvent` |
| 执行引擎 + 取消 | `crates/execution-engine`：Driver SPI、cancel、契约测试骨架 |
| 事件流通道 | `crates/event-stream` |
| HTTP/HTTPS Driver | `crates/driver-http`（reqwest，流式 chunk、超时、取消） |
| CLI 烟测 | `apivoy-cli http-get` / `drivers` |
| Local Agent | `127.0.0.1:39217`；Bearer Token；Origin 限 `localhost:5180` |
| Desktop（Tauri） | `http_get` / `cancel_execution` / `list_drivers` |
| Web 工作台 | 经 Agent 调试 HTTP，支持方法/Header/Body/认证/变量/断言/历史 |
| 共享 UI 壳 | `@apivoy/ui`：`AppShell` + `HttpWorkbench`，Desktop/Web 共用 |
| TS 请求模型镜像 | `@apivoy/request-model`（手写，协议 ID 类型已预留） |
| 生命周期枚举预留 | `LifecyclePhase` + `NoopLifecycleHook` |
| ADR | Tauri、双二进制、WASM-only 插件 |

### 2.2 端到端现状（唯一通路）

```text
HTTP 请求（GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS）
  → Desktop Tauri / Web→Agent / CLI
  → ExecutionEngine → HttpDriver → reqwest
  → 摘要 + 正文预览（≤4KB）
```

### 2.3 完成度粗估

| 范围 | 相对 PRD MVP | 说明 |
|------|--------------|------|
| 阶段 0 架构 | ~95% | 正式执行 API、SQLite、版本握手已落地 |
| MVP / M1 内核 | ~100%（M1 退出条件） | HTTP 保存→环境→发送→断言→历史闭环；七协议属 M2 |
| P1 / P2 | 持续推进 | P1 协议、脚本、插件、Mock、集合运行器已完成；P2 协作、AI、抓包、云协议网关与私有化均已完成 |

---

## 3. 需求缺口矩阵

图例：✅ 已实现 · 🟡 部分/骨架 · ❌ 未开始 · ⏭ 按定稿延后

### 3.1 PRD 功能需求（F-xxx）

| 编号 | 模块 | PRD | 定稿阶段 | 现状 | 缺口摘要 |
|------|------|-----|----------|------|----------|
| F-001 | 工作区与项目 | P0 | P0 | ✅ | 工作区/项目 CRUD、搜索、切换、归档与恢复、最近访问排序及 Web/Desktop 共享资源树均已实现 |
| F-002 | 集合与目录 | P0 | P0 | ✅ | 嵌套集合树、搜索、CRUD、标签、拖拽归类与同级拖拽排序、请求批量移动/删除均已实现 |
| F-003 | 统一请求编辑器 | P0 | P0 | ✅ | HTTP/SSE/TCP/UDP/GraphQL/WebSocket/gRPC 七协议双端编辑器、变量、认证、断言及协议专属配置均已实现 |
| F-004 | 请求执行 | P0 | P0 | ✅ | HTTP 可发可取消；重试/代理/TLS 校验/重定向、Cookie Jar 可视化管理、文本/文件 multipart、Keychain 合并 PEM 客户端证书均已接入 |
| F-005 | 响应工作台 | P0 | P0 | ✅ | 分块接收、64MB 正文 Blob、Headers、JSON 美化/原文/Hex/表格、完整执行事件时间线、万字符窗口化大响应渲染、复制与下载均已实现 |
| F-006 | 环境与变量 | P0 | P0 | ✅ | 多级作用域 + `{{var}}`；Desktop/Agent 环境持久化 |
| F-007 | 机密管理 | P0 | P0 | ✅ | Keychain + secret_ref；导出扫描属 M3 |
| F-008 | 认证 | P0 | P0 | ✅ | Basic/Bearer/API Key、OAuth 2.0 Client Credentials、Authorization Code + PKCE S256 浏览器授权（授权码/verifier 仅进入 Keychain/Agent secret-store）及不落盘的 TLS 客户端证书均已完成 |
| F-009 | 前后置脚本 | P0 | **P1** | ✅ | QuickJS 前/后置脚本、request/response/variables/console/assert/crypto API、16MB 内存与 500ms 超时限制、HTTP 双端编辑器、变量提取事件及 Agent/Desktop/CLI 跨请求持久化已实现 |
| F-010 | 断言与测试 | P0 | P0 | ✅ | 内置状态码/耗时/大小/Header/JSONPath/文本包含 |
| F-011 | 历史与重放 | P0 | P0 | ✅ | 本地历史、筛选、对比、重放（Desktop + Agent/Web） |
| F-012 | 导入导出 | P0 | P0 | ✅ | cURL、OpenAPI JSON/YAML、HAR、Postman v2 与 ApiVoy 项目包已接入；支持 OpenAPI 内部及跨文件 `$ref`、循环检测、Schema 请求示例、server variables 与 Postman variables 映射，文件夹/tag/page 映射子集合及敏感扫描 |
| F-013 | 代码生成 | P1 | P1 | ✅ | HTTP 工作台支持 cURL、JavaScript Fetch、Python Requests、Go net/http、Rust reqwest、Java HttpClient；GraphQL/gRPC/WebSocket/SSE/TCP/UDP 均有专用生成器，并开放 HTTP 与协议模板注册/卸载插件点 |
| F-014 | 集合运行器 | P1 | P1 | ✅ | CLI 支持 RequestEnvelope/ApiVoy 项目集合、顺序/并发、失败即停、跨请求变量、JSON/CSV 数据迭代、JSON/JUnit 报告和结构化退出码；Desktop 支持当前集合运行、失败即停与断言报告 |
| F-015 | Mock 服务 | P1 | P1 | ✅ | Agent HTTP/WebSocket Mock、规则 CRUD/持久化、确定性优先级/方法精确度匹配、Status/Header/Body、连接消息/回显、延迟、周期错误注入及 Web/Desktop 管理入口均已实现 |
| F-016 | 团队协作 | P1 | **P2** | ✅ | Java 21 / Spring Boot 3 协作服务与双端 Team/Comments/SSO 工作台已覆盖 Owner 引导、邮箱密码及企业 OIDC 登录、已验证邮箱 JIT 入组、联合身份绑定、设备会话、组织成员、五级 RBAC、脱敏资源树快照、幂等层级恢复、revision/增量同步、冲突合并 UI、评论主题/回复/解决状态、SSE 实时变更与审计 |
| F-017 | 插件中心 | P1 | P1 | ✅ | Wasmtime Component-only 宿主、Transformer/Protocol/Auth/Importer 专用 WIT 入口、权限校验、SHA-256、防篡改、Ed25519 发布者信任链、内存/fuel 限制、Agent/Desktop 安装/启停/卸载/按类型调用 API 与 Web/Desktop 插件中心已实现 |
| F-018 | AI 辅助 | P2 | P2 | ✅ | Web/Desktop AI 工作台支持自然语言生成 HTTP 请求、响应解释、断言与文档生成；OpenAI-compatible/Ollama BYOK，密钥仅进入 Keychain/Agent secret-store，远程 HTTPS 强制、结果预览后应用、双端共享 Rust 客户端与 Provider 契约测试均已完成 |
| F-019 | 流量代理抓包 | P2 | P2 | ✅ | Web/Desktop Capture 工作台与共享 Rust 显式代理已完成；HTTP 请求/响应 Header 与 64KB 正文预览、HTTPS CONNECT 加密隧道元数据、loopback 安全默认、敏感 Header 脱敏、500 条环形保留、生命周期控制及一键生成 HTTP 请求均已实现 |
| F-020 | 私有化部署 | P2 | P2 | ✅ | 单入口 Nginx + Web + Rust Agent + Java 协作/OIDC + PostgreSQL Compose 编排；运行时前端配置、内部反向代理、最小端口暴露、健康检查、持久化卷、环境模板、部署文档与镜像构建 CI 已完成 |

### 3.2 MVP 协议矩阵（G1 / AC-03）

| 协议 | 现状 | 缺口 |
|------|------|------|
| HTTP/HTTPS | ✅ Driver + 双端工作台 | 编辑器、自动 Cookie Jar 与双端管理、multipart、代理/TLS/客户端证书 UI、OpenAPI 导入、事件级实时响应 UI 与响应持久化已实现 |
| WebSocket | ✅ Driver + 双端工作台 | ws/wss、Text/Binary、子协议、自定义 Header、Ping/Pong、取消、自动重连、响应持久化，以及 Web/Desktop 原生持久连接后的多次交互发送与双向帧时间线均已实现 |
| SSE | ✅ Driver + 双端工作台 | 强类型载荷、事件级增量 UI、流式接收、取消、Last-Event-ID、服务端 retry、可配置自动重连、变量/认证和响应持久化已实现 |
| GraphQL | ✅ Driver + 双端工作台 | Query/Mutation/WS Subscription、Variables、operationName、自定义 Header、Schema Introspection/类型浏览、Monaco 语法高亮与关键字补全、GraphQL errors 提示、取消与历史持久化均已实现 |
| gRPC | ✅ Driver + 双端工作台 | 通用 protobuf Base64、HTTP/2、Unary/Server/Client/Bidi 四类流、Metadata、FileDescriptorSet 导入、Server Reflection 自动描述符发现、JSON↔Protobuf、取消与响应持久化均已实现 |
| TCP | ✅ Driver + 双端工作台 | 文本/Hex、固定长度/分隔符分帧、系统根/自定义 CA TLS、SNI、定时重复发送、超时、取消、响应持久化，以及经配对 Token 保护的 Agent 持久 TCP 交互桥接均已实现 |
| UDP | ✅ Driver + 双端工作台 | 文本/Hex、重复/定时发送、接收超时、取消和响应持久化已实现 |

> P1 协议扩展已完成 SOAP、JSON-RPC、Redis、MQTT 3.1.1、AMQP、Kafka 与 PostgreSQL/MySQL/SQLite，均已注册到 Agent/Desktop/CLI 并提供 Web/Desktop 工作台。

### 3.3 架构文档模块缺口

| 模块（架构 §5 / §8–12） | 现状 | 目标阶段 |
|-------------------------|------|----------|
| SQLite 本地库（workspace/request/history…） | ✅ | P0-M0/M1 |
| Agent 正式 API（executions + SSE + env/history/request） | ✅ | 执行闭环、长期配对 Token → 8 小时 session Token 交换、过期清理及 TCP 会话桥接鉴权均已实现 |
| Desktop ↔ Agent 版本握手 | ✅ `protocol_api_version: "1"` | P0-M0 |
| Desktop 捆绑 Agent sidecar | ✅ | 构建钩子按 Rust host triple 自动编译、重命名并通过 Tauri `externalBin` 捆绑 `apivoy-agent` |
| OS Keychain 接入 | ✅ | P0-M1 |
| 变量解析 + 内置断言 | ✅ | P0-M1 |
| 导入导出包 `packages/import-export` | ✅ | 已实现 JSON/YAML 格式识别、四类导入、内部/外部 `$ref`、Schema 示例、环境变量映射、层级映射、项目包导出与敏感扫描 |
| Monaco / 命令面板 / i18n | 🟡 | 离线本地 Monaco 已用于 HTTP Body、QuickJS、GraphQL/JSON；Ctrl/⌘+K、协议标签工作台、语言资源运行时、中文/英文持久化切换、核心导航及全部工作台标签翻译已实现；待迁移工作台内部细粒度文案 |
| TanStack Query + Zustand 分层 | ✅ | Web/Desktop 共享 QueryClient Provider；Gateway 服务端任务/历史使用 TanStack Query 缓存，活动工作台等客户端状态使用 Zustand 持久化 Store |
| `plugin-runtime` + Wasmtime | ✅ | Component-only 四类插件宿主、权限与资源限制、Ed25519 签名校验、双端插件中心已接入 |
| QuickJS 脚本 | ✅ | 受限运行时、request/response/variables/console/assert/crypto API、HTTP 双端编辑器和跨请求变量数据链已接入 |
| Java 协作微服务拆分 | 🟡 | 可部署单体已覆盖 identity/OIDC SSO/workspace/sync/audit，支持 H2 本地与 PostgreSQL/Docker 私有化；mock/automation 拆分待后续切片 |
| 云协议网关 `protocol-gateway` | ✅ | 独立 Rust 服务复用全部协议 Driver，提供 Bearer 鉴权远程执行、持久化间隔调度、CI Runner 结构化退出码、并发上限、执行留存与明确数据流向 |
| CI：三平台构建 / E2E / SBOM | 🟡 | GitHub Actions 已覆盖三平台 Desktop/sidecar 检查、Playwright 桌面/移动浏览器冒烟、全工作区测试、Clippy、RustSec、CycloneDX SBOM、私有化 Compose 模型/镜像构建与 tag 草稿发布；待补真实安装/升级/卸载验证 |

### 3.4 MVP 验收标准（AC）对照

| 编号 | 验收条件 | 现状 |
|------|----------|------|
| AC-01 | 三平台安装/升级/卸载一致 | 🟡 三平台 Tauri + Agent/CLI 发布流水线和完整平台图标已建立；待 CI 实机验证安装、升级、卸载 |
| AC-02 | Web 完成 HTTP/GraphQL/WS + 安全连 Agent | ✅ HTTP/GraphQL/WS 正式执行通路与配对 Bearer Token 已完成 |
| AC-03 | 七协议创建/保存/发送/取消/响应/历史 | ✅ Web/Desktop 七协议保存、资源树按协议恢复、发送/取消、响应持久化与统一历史回放均已贯通 |
| AC-04 | 变量、Secret、认证、脚本、断言复用 | ✅ 变量/Secret/五类认证/QuickJS 前后置脚本/断言已贯通 |
| AC-05 | OpenAPI/cURL/HAR/Postman + 敏感检测 | ✅ 四类导入与 Header/Query/Body 敏感检测已完成 |
| AC-06 | gRPC 四类流；TCP/UDP 文本+Hex；WS 双帧 | ✅ gRPC 四类流批次/逐帧编解码、TCP/UDP Text+Hex、WS Text/Binary 均已实现 |
| AC-07 | 10MB/长流不冻 UI；可取消 | ✅ 内核可取消、正文外置 Blob、事件增量接收与万字符窗口渲染已完成 |
| AC-08 | Secret 不明文落盘/日志/导出 | ✅ Keychain/Agent secret-store + runtime secret + 导出敏感扫描已完成 |
| AC-09 | 异常退出数据完整 + 草稿恢复 | ✅ 请求/环境/历史已持久化；HTTP、GraphQL、gRPC、WebSocket、SSE、TCP/UDP 工作台草稿均自动保存并在重启后恢复，损坏草稿自动丢弃 |
| AC-10 | 单测/集成/E2E/安全/安装冒烟 | 🟡 Rust/TS 单测、Playwright 桌面/移动浏览器 UI 冒烟、三平台 CI、Clippy、RustSec 与 SBOM 已建立；待完成三平台安装生命周期验证 |

---

## 4. 分期总览

```text
阶段 0（当前）     M0 架构收口
       ↓
MVP / P0           M1 内核 → M2 七协议 → M3 自动化与导入 → M4 工作台打磨
       ↓
P1                 脚本 / WASM 插件 / MQ·DB / Mock / CLI 集合 / 导入增强
       ↓
P2（商业闭源为主）  身份 / 团队同步 / 审计 / Java 协作服务 / 云网关 / 私有化
```

| 阶段 | 建议周期 | 退出条件（一句话） |
|------|----------|--------------------|
| **阶段 0** | 1–2 周（收口） | Desktop / Web+Agent / CLI 共用正式执行 API 发 HTTP；SQLite 可存请求 |
| **MVP (P0)** | 12–16 周 | 满足定稿后的 MVP 验收（七协议 + 本地工作区 + 变量/认证/断言/历史/导入） |
| **P1** | 12–18 周 | QuickJS、WASM 插件、MQ/DB、Mock、集合运行器可用 |
| **P2** | 持续 | 团队同步与企业私有化可部署 |

---

## 5. 阶段 0 收口（立即执行）

目标：把「烟测骨架」变成「可迭代产品基线」。

| # | 切片 | 交付物 | 退出标准 |
|---|------|--------|----------|
| 0.1 | 品牌残留清理 | UI 去 “Rq”/Reqonaut；统一 ApiVoy 文案 | 用户可见面无旧名 |
| 0.2 | 正式执行 API | Agent：`POST /v1/executions` + `GET .../events`（SSE）+ cancel；Desktop 同等 Command | 不再依赖 `/v1/debug/http-get` 作为主路径 |
| 0.3 | 版本握手 | `desktopVersion` / `agentVersion` / `protocolApiVersion` | 不兼容时拒绝并提示升级 |
| 0.4 | SQLite 最小库 | project / collection / request / execution 摘要表 + 迁移 | 保存/打开一个 HTTP 请求 |
| 0.5 | HTTP 编辑器最小集 | method、headers、body、timeout | Desktop 与 Web 行为一致 |
| 0.6 | 验收烟测 | CLI + Desktop + Web+Agent 各跑通一次 | 文档验收清单可勾选 |

**阶段 0 验收锚点**

- [x] Monorepo 使用 ApiVoy 命名与 Apache-2.0
- [x] `LifecyclePhase` 钩子预留
- [x] Agent 本机监听 + Bearer/Origin 基础防护
- [x] `apivoy-cli http-get` 纳入可重复验证（文档/脚本）— 见 [`SMOKE_CHECKLIST.md`](./SMOKE_CHECKLIST.md)
- [x] Desktop / Web+Agent 经**正式执行 API**完成 HTTP 通路（`POST /v1/executions` + SSE；Desktop `execute_request`）
- [x] 本地 SQLite 可保存并重新打开请求（`crates/local-store` + Desktop 保存/打开）
- [x] Desktop ↔ Agent 版本握手字段生效（`protocolApiVersion` / `agentVersion` / `desktopVersion`；不兼容 426）

---

## 6. MVP / P0 详细计划

价值链（必须打通）：

```text
选协议 → 编辑请求 → 选环境/变量 → Desktop 或 Agent 发送
→ 流式响应 → 断言 → 写入历史 → 保存到集合 → 再次执行
```

数据默认：**SQLite + 本地 Blob 文件 + OS Keychain**；不强制注册、不依赖服务器。

### 6.1 M1 — 内核与本地数据（约 3–4 周）

| 工作包 | 内容 | 进度 |
|--------|------|------|
| 持久化 | SQLite 表：workspace/project/collection/request/environment/variable/secret_ref/execution/blob_index；大正文外置 | ✅ `workspace` + `blob_index`；请求大正文 / 大预览外置（≥64KB）；variable/secret_ref 仍嵌在 environment JSON（M1 可接受） |
| 变量 | 多级作用域 + `{{var}}` / 动态变量；解析阶段挂生命周期 | ✅ `VariableScope` + `{{var}}`/`$uuid`/`$timestamp`/`$isoTimestamp` 已接入引擎 |
| Secret | Keychain 读写；项目仅存 `secret_ref`；事件/导出脱敏管道骨架 | ✅ Keychain + UI「存入密钥」+ Agent `PUT /v1/secrets`；导出敏感扫描属 M3，本里程碑不要求 |
| 认证 | Basic、Bearer、API Key；证书引用（TLS 客户端证书可后置半周） | ✅ Basic/Bearer/API Key 引擎注入 + Desktop/Web UI；TLS 客户端证书按计划后置 |
| 断言（无脚本） | 状态码、耗时、大小、Header、JSONPath、文本包含 | ✅ 引擎内置断言 + Desktop/Web UI 文本 DSL |
| 历史 | 本地执行摘要、筛选、重放、从历史生成请求 | ✅ Desktop/Agent/Web 均持久化；筛选（state/status）+ 双条预览对比 + 重放 |
| 错误模型 | Validation / Resolution / Connection / TLS / Protocol 统一字段 | ✅ `ErrorKind` 迁入 `core-domain`；`DomainError` 覆盖全 kind；引擎 `to_domain()` / wire code 对齐 |

**退出**：HTTP 请求可「保存 → 换环境变量 → 发送 → 断言 → 历史重放」闭环。✅（Desktop 与 Web→Agent 均已打通）

**M1 明确后置（非本里程碑阻塞）**

- TLS 客户端证书（计划写明可后置）
- OAuth 授权码流（§11：P0 末或 P1）
- 导出敏感扫描（M3 工作包）

### 6.2 M2 — MVP 七协议（约 5–6 周）

| 顺序建议 | Crate / 能力 | 契约测试最低集 |
|----------|--------------|----------------|
| 1 | 增强 `driver-http`（Cookie、代理、重定向策略、流式 UI） | 成功/超时/取消/TLS/大响应 |
| 2 | `driver-sse` | 事件类型、重连、取消 |
| 3 | `driver-websocket` | 文本/二进制、Ping、断开、取消 |
| 4 | GraphQL（HTTP + WS 订阅适配） | Query/Mutation；订阅后置可降级为 P1 若排期紧 |
| 5 | `driver-grpc`（tonic） | Unary 优先；再补 Client/Server/Bidi |
| 6 | `driver-tcp-udp` + 分帧器 | 文本/Hex；TCP TLS；固定长/分隔符分帧 |

同步前端：

- `Protocol Editor Host`（按 Driver Descriptor / UI Schema 切换）
- 事件流控制台（增量渲染、暂停渲染、取消）
- 长连接：连接/断开/重连/消息时间线

**退出**：七协议均可创建、保存、发送、取消、查看事件/响应；gRPC 至少 Unary + 一种 Streaming；TCP/UDP 文本+Hex。

### 6.3 M3 — 导入导出与自动化基线（约 3–4 周）

| 工作包 | 内容 |
|--------|------|
| 导入 | OpenAPI 3、cURL、HAR、Postman Collection v2 |
| 导出 | 项目包 / 集合；导出前敏感字段扫描 |
| 文件格式 | `*.apivoy.json`（Git 友好）与 SQLite 并存策略落地（回应 ADR-008） |
| CLI | 运行单个请求 / 简单集合；结构化退出码 |
| 响应视图 | JSON/XML 格式化、Hex、虚拟列表（10MB 场景） |
| 草稿恢复 | 异常退出未保存草稿可恢复 |

**退出**：AC-05 / AC-07 / AC-09 可演示；GUI 与 CLI 对同一请求结果一致。

### 6.4 M4 — 工作台与发布打磨（约 2–3 周）

| 工作包 | 内容 |
|--------|------|
| 信息架构 | 左：项目/集合/历史；中：编辑器；底：响应/事件/断言；右：环境 |
| UX | 命令面板、快捷键、环境生产标签警告 |
| Agent UX | 配对码流程（替代纯环境变量拷贝）；能力列表展示 |
| 质量 | 协议契约测试矩阵；Desktop/Web 基础 E2E；三平台安装包冒烟 |
| 安全 | Origin/令牌完善；Secret 不明文；生产写操作二次确认（个人模式） |

**退出**：内部团队可用 ApiVoy 替代日常 HTTP + 至少 2 种非 HTTP 协议调试。

### 6.5 P0 明确不做（避免范围膨胀）

- 团队云同步、RBAC、评论、审计服务  
- QuickJS 用户脚本（仅保留钩子与内置断言）  
- WASM 第三方插件市场  
- MQTT/Kafka/Redis/DB/Mock  
- AI、全流量抓包、云协议网关  

---

## 7. P1 计划（MVP 之后）

| 主题 | 交付 | 依赖 |
|------|------|------|
| QuickJS 脚本 | 挂载同一生命周期；受控 API（request/response/variables/crypto/assert） | M1 生命周期 |
| WASM 插件 | ✅ Wasmtime + 四类专用 WIT、权限模型、Ed25519 信任链与插件中心均已实现 | ADR-0003 |
| 协议扩展 | ✅ SOAP、JSON-RPC、Redis、MQTT、AMQP、Kafka、SQL 已完成 | MQTT 覆盖 MQTTS、自定义 CA/SNI、QoS 0/1/2 双向状态机；SQL 覆盖 PostgreSQL/MySQL/SQLite、参数、事务与结果限额 |
| Mock | ✅ HTTP/WebSocket Mock、规则持久化、确定性匹配、延迟与周期错误注入、Web/Desktop 管理台均已完成 | 本地执行层 |
| 集合运行器 | ✅ CLI 支持 RequestEnvelope/ApiVoy 项目 JSON、顺序/并发、失败即停、跨请求变量、JSON/CSV 数据迭代及 JSON/JUnit 报告；Desktop 提供集合报告页 | CLI + 断言 |
| 代码生成 | 多语言片段 + 模板插件点 | 请求模型稳定 |
| Desktop sidecar | 可选捆绑 `apivoy-agent` | 版本握手 |

**退出**：第三方可按 SDK 开发并安装一个 WASM 协议插件；CLI 可在 CI 跑集合。

---

## 8. P2 计划（商业 / 闭源为主）

| 主题 | 交付 |
|------|------|
| 身份与组织 | 登录、SSO、设备会话 |
| 工作区同步 | 增量变更、revision、冲突 UI；Secret 仅同步引用 |
| RBAC / 审计 | Owner/Admin/Editor/Runner/Viewer；高风险操作审计 |
| Java 服务 | identity / workspace / sync / audit / mock / automation（可单体起步） |
| 云协议网关 | 远程执行、定时、CI Runner；数据流向明示 |
| 企业 | 私有化部署、组织策略、插件签名策略、更新通道锁定 |
| 探索 | AI 辅助、代理抓包、长尾协议（Dubbo/Thrift/IoT） |

**退出**：团队可共享非敏感项目资产；私有化最小部署可跑通同步。

---

## 9. 脚本生命周期（跨阶段不变）

```text
before_request
→ resolve_variables
→ build_request
→ send_request
→ receive_headers
→ receive_stream_chunk
→ receive_complete
→ run_assertions
→ extract_variables
→ after_response
```

| 阶段 | 行为 |
|------|------|
| P0 | 无用户脚本；内置变量替换、提取（JSONPath/Header/Cookie）、断言 |
| P1 | QuickJS 挂到同一相位；GUI/CLI 同引擎 |
| P2 | 组织策略限制脚本能力；审计高风险脚本 |

---

## 10. 建议研发节奏（参考架构 §17）

| 角色 | 建议 | 主责 |
|------|------|------|
| 技术负责人 | 1 | SPI、安全边界、质量门禁 |
| Rust | 2–3 | 内核、Driver、Agent、CLI、后续插件运行时 |
| 前端 | 2 | 工作台、编辑器、流式 UI |
| Java | 0（P0）→ 1–2（P2） | 协作服务 |
| 测试 | 1 | 协议环境、契约、三平台冒烟 |
| 产品/设计 | 1 | 协议优先级、验收、交互 |

单线程或小团队时，严格按 **0 → M1 → HTTP 打磨 → SSE/WS → 其余协议 → 导入** 削峰，禁止并行铺太多 Driver。

---

## 11. 风险与待拍板（仍开放）

| 事项 | 建议 |
|------|------|
| GraphQL 订阅是否硬卡 MVP | 若排期紧，MVP 可只做 HTTP GraphQL，订阅顺延 P1 |
| 项目文件：SQLite vs `*.apivoy.json` | **混合**：运行期 SQLite，分享/Git 用 JSON 包 |
| OAuth 2.0 是否进 P0 | 建议 P0 做 Bearer/API Key；OAuth 授权码流放 P0 末或 P1 |
| 生产环境组织级审批 | 个人模式二次确认即可；组织策略随 P2 |
| QuickJS vs 其他运行时 | 维持 ADR：P1 PoC 后再冻结 |
| 三平台发布人力 | MVP 内测可先 Win+macOS；Linux 紧随，AC-01 发布前补齐 |

---

## 12. 下一迭代（建议 1–2 周）

> **M1 已收口**（2026-08-05）：内核持久化 / 变量 / Secret / 认证 / 断言 / 历史 / 错误模型均达退出条件。  
> 建议下一迭代进入 **M2**：增强 HTTP（Cookie/代理/重定向）并启动 SSE / WebSocket Driver。

1. `driver-http`：Cookie、代理、重定向策略、流式 UI 契约测试  
2. 新建 `driver-sse` 最小通路  
3. 新建 `driver-websocket` 最小通路  
4. Protocol Editor Host 骨架（按 Driver Descriptor 切换）  

---

## 13. 文档索引

| 文档 | 路径 |
|------|------|
| 产品需求 PRD V1.1 | 仓库根目录 `*PRD_V1.1.docx`（提取文本：`docs/_extract/prd.txt`） |
| 技术架构 V1.0 | 仓库根目录 `*技术架构*.docx`（提取文本：`docs/_extract/arch.txt`） |
| 品牌 | [`docs/BRANDING.md`](./BRANDING.md) |
| ADR | [`docs/adr/`](./adr/) |
| 本计划 | [`docs/PHASE_PLAN.md`](./PHASE_PLAN.md) |
