# ApiVoy 阶段计划与缺口对照

> 基于 PRD V1.1、技术架构 V1.0，以及 2026-08-05 品牌与技术定稿。  
> 对照日期：2026-08-05（代码库现状快照）。

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

当前仓库处于 **阶段 0（基础架构）接近收尾、MVP 尚未真正启动** 的状态。

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
| Web 工作台 | 经 Agent 调试 HTTP GET |
| 共享 UI 壳 | `@apivoy/ui`：`AppShell` + `HttpWorkbench`（GET-only） |
| TS 请求模型镜像 | `@apivoy/request-model`（手写，协议 ID 类型已预留） |
| 生命周期枚举预留 | `LifecyclePhase` + `NoopLifecycleHook` |
| ADR | Tauri、双二进制、WASM-only 插件 |

### 2.2 端到端现状（唯一通路）

```text
URL（GET only）
  → Desktop Tauri / Web→Agent / CLI
  → ExecutionEngine → HttpDriver → reqwest
  → 摘要 + 正文预览（≤4KB）
```

### 2.3 完成度粗估

| 范围 | 相对 PRD MVP | 说明 |
|------|--------------|------|
| 阶段 0 架构 | ~70% | HTTP 通路通；缺 SQLite、正式执行 API、版本握手 |
| MVP 产品面 | ~5–10% | 仅 HTTP 烟测；六协议与工作区/变量/断言等未做 |
| P1 / P2 | ~0% | README / 占位为主 |

---

## 3. 需求缺口矩阵

图例：✅ 已实现 · 🟡 部分/骨架 · ❌ 未开始 · ⏭ 按定稿延后

### 3.1 PRD 功能需求（F-xxx）

| 编号 | 模块 | PRD | 定稿阶段 | 现状 | 缺口摘要 |
|------|------|-----|----------|------|----------|
| F-001 | 工作区与项目 | P0 | P0 | ❌ | 无 Workspace/Project；无搜索/归档 |
| F-002 | 集合与目录 | P0 | P0 | ❌ | 无树形集合、拖拽、标签 |
| F-003 | 统一请求编辑器 | P0 | P0 | 🟡 | 仅 URL+GET；无公共区/协议区、认证、脚本位 |
| F-004 | 请求执行 | P0 | P0 | 🟡 | HTTP 可发可取消；缺重试/代理/TLS UI/Cookie/完整事件流 API |
| F-005 | 响应工作台 | P0 | P0 | 🟡 | 摘要+预览；缺格式化/Hex/表格/时间线/虚拟列表 |
| F-006 | 环境与变量 | P0 | P0 | ❌ | Envelope 有字段；无 `{{var}}` 解析与多级作用域 |
| F-007 | 机密管理 | P0 | P0 | 🟡 | `secret-store` 内存 stub，未接入 Keychain/执行链路 |
| F-008 | 认证 | P0 | P0 | ❌ | 无 Basic/Bearer/API Key/OAuth/JWT/证书 UI 与解析 |
| F-009 | 前后置脚本 | P0 | **P1** | ⏭ | 生命周期钩子已预留；无 QuickJS |
| F-010 | 断言与测试 | P0 | P0 | ❌ | 事件类型有；无状态码/耗时/JSONPath 等内置断言 |
| F-011 | 历史与重放 | P0 | P0 | ❌ | 无本地历史、对比、从历史生成请求 |
| F-012 | 导入导出 | P0 | P0 | ❌ | 无 OpenAPI/cURL/HAR/Postman；无敏感扫描 |
| F-013 | 代码生成 | P1 | P1 | ❌ | — |
| F-014 | 集合运行器 | P1 | P1 | ❌ | CLI 仅 http-get，无集合运行 |
| F-015 | Mock 服务 | P1 | P1 | ❌ | — |
| F-016 | 团队协作 | P1 | **P2** | ⏭ | `collaboration-server` 仅 README |
| F-017 | 插件中心 | P1 | P1 | ❌ | `plugins/sdk` 仅 README |
| F-018 | AI 辅助 | P2 | P2 | ❌ | — |
| F-019 | 流量代理抓包 | P2 | P2 | ❌ | — |
| F-020 | 私有化部署 | P2 | P2 | ❌ | — |

### 3.2 MVP 协议矩阵（G1 / AC-03）

| 协议 | 现状 | 缺口 |
|------|------|------|
| HTTP/HTTPS | ✅ Driver + 烟测通路 | 完整编辑器、Cookie、代理/TLS UI、OpenAPI 导入、流式 UI |
| WebSocket | ❌ | `driver-websocket`；连接/帧时间线/重连 |
| SSE | ❌ | `driver-sse`；Last-Event-ID、增量渲染 |
| GraphQL | ❌ | Query/Mutation/Variables；订阅依赖 WS |
| gRPC | ❌ | Proto/反射；Unary + 三类 Streaming |
| TCP | ❌ | 文本/Hex、分帧、TLS |
| UDP | ❌ | 文本/Hex、编码、定时发送 |

> P1 协议（MQTT/AMQP/Kafka/Redis/SQL/SOAP…）与 P2/插件协议均未开始，符合分期。

### 3.3 架构文档模块缺口

| 模块（架构 §5 / §8–12） | 现状 | 目标阶段 |
|-------------------------|------|----------|
| SQLite 本地库（workspace/request/history…） | ❌ | P0-M0/M1 |
| Agent 正式 API（pair/session/executions + SSE） | 🟡 debug http-get | P0-M0 |
| Desktop ↔ Agent 版本握手 | 🟡 `protocol_api_version: "1"` | P0-M0 |
| Desktop 捆绑 Agent sidecar | ❌ | P0 后期 / P1 |
| OS Keychain 接入 | 🟡 stub | P0-M1 |
| 变量解析 + 内置断言 | ❌ | P0-M1 |
| 导入导出包 `packages/import-export` | ❌ | P0-M3 |
| Monaco / 命令面板 / i18n | ❌ | P0 UI |
| TanStack Query + Zustand 分层 | ❌ 未引入 | P0 UI |
| `plugin-runtime` + Wasmtime | ❌ | P1 |
| QuickJS 脚本 | ❌ | P1 |
| Java 协作微服务拆分 | ❌ README | P2 |
| 云协议网关 `protocol-gateway` | ❌ | P2 |
| CI：三平台构建 / E2E / SBOM | ❌ | 随里程碑补齐 |

### 3.4 MVP 验收标准（AC）对照

| 编号 | 验收条件 | 现状 |
|------|----------|------|
| AC-01 | 三平台安装/升级/卸载一致 | ❌ 无发布流水线 |
| AC-02 | Web 完成 HTTP/GraphQL/WS + 安全连 Agent | 🟡 仅 HTTP GET + Token |
| AC-03 | 七协议创建/保存/发送/取消/响应/历史 | ❌ 仅 HTTP 发送/取消 |
| AC-04 | 变量、Secret、认证、脚本、断言复用 | ❌（脚本定稿延后 P1） |
| AC-05 | OpenAPI/cURL/HAR/Postman + 敏感检测 | ❌ |
| AC-06 | gRPC 四类流；TCP/UDP 文本+Hex；WS 双帧 | ❌ |
| AC-07 | 10MB/长流不冻 UI；可取消 | 🟡 内核可取消；UI 未虚拟化 |
| AC-08 | Secret 不明文落盘/日志/导出 | ❌ Keychain 未接 |
| AC-09 | 异常退出数据完整 + 草稿恢复 | ❌ 无持久化 |
| AC-10 | 单测/集成/E2E/安全/安装冒烟 | 🟡 少量 Rust 测试 |

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
| 持久化 | SQLite 表：workspace/project/collection/request/environment/variable/secret_ref/execution/blob_index；大正文外置 | 🟡 已有 project/collection/request/environment/execution（含快照）；workspace/blob_index 待补 |
| 变量 | 多级作用域 + `{{var}}` / 动态变量；解析阶段挂生命周期 | 🟡 `VariableScope` + `{{var}}`/`$uuid`/`$timestamp` 已接入引擎 |
| Secret | Keychain 读写；项目仅存 `secret_ref`；事件/导出脱敏管道骨架 | 🟡 `secret-store` Keychain + 内存回退 + `redact`；UI 存密钥仍简陋 |
| 认证 | Basic、Bearer、API Key；证书引用（TLS 客户端证书可后置半周） | ❌ |
| 断言（无脚本） | 状态码、耗时、大小、Header、JSONPath、文本包含 | 🟡 引擎内置断言 + Desktop/Web UI 文本 DSL |
| 历史 | 本地执行摘要、筛选、重放、从历史生成请求 | 🟡 Desktop 列表 + 重放；筛选/对比待补 |
| 错误模型 | Validation / Resolution / Connection / TLS / Protocol 统一字段 | 🟡 Resolution/Validation 事件已发；统一错误模型未收敛 |

**退出**：HTTP 请求可「保存 → 换环境变量 → 发送 → 断言 → 历史重放」闭环。

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
| WASM 插件 | Wasmtime + WIT；Protocol/Auth/Importer 示例；权限模型 | ADR-0003 |
| 协议扩展 | MQTT、AMQP、Kafka、Redis、SQL、SOAP/JSON-RPC | Driver SPI 稳定 |
| Mock | HTTP/WS 规则、延迟、错误注入 | 本地执行层 |
| 集合运行器 | 顺序/并发、数据驱动、失败策略、报告；CI 示例 | CLI + 断言 |
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

1. 落地 Agent/Desktop **正式执行 API** + SSE 事件流  
2. SQLite：**保存/打开 HTTP 请求**  
3. HTTP 编辑器：method / headers / body  
4. 版本握手字段  
5. 勾选阶段 0 验收锚点；开 M1 变量与断言  

---

## 13. 文档索引

| 文档 | 路径 |
|------|------|
| 产品需求 PRD V1.1 | 仓库根目录 `*PRD_V1.1.docx`（提取文本：`docs/_extract/prd.txt`） |
| 技术架构 V1.0 | 仓库根目录 `*技术架构*.docx`（提取文本：`docs/_extract/arch.txt`） |
| 品牌 | [`docs/BRANDING.md`](./BRANDING.md) |
| ADR | [`docs/adr/`](./adr/) |
| 本计划 | [`docs/PHASE_PLAN.md`](./PHASE_PLAN.md) |
