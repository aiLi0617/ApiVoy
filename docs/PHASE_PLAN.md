# ApiVoy 阶段计划

基于 PRD V1.1、技术架构 V1.0，以及 2026-08-05 品牌与技术定稿。

## 定稿原则

| 项 | 决策 |
|----|------|
| 产品名 | ApiVoy（旧称 Reqonaut；ApiLens 仅为内部代号） |
| 许可证 | Apache-2.0 核心开源；企业云能力闭源 |
| MVP | Local-first，无账号完整可用；团队同步放 P2 |
| Desktop / Agent | 共享 crates，双二进制，统一版本握手 |
| 插件 | 第三方仅 WASM；官方可保留原生适配器 |
| 脚本 | P0 预留生命周期；P1 接入 QuickJS |
| 协作后端 | P2：Java 21 + Spring Boot 3 + Gradle Wrapper |

## 分期

### P0 / MVP（当前）

Desktop、Web UI、Local Agent、HTTP/HTTPS、WebSocket、SSE、GraphQL、gRPC、TCP/UDP、环境变量、请求历史、本地项目与集合、OpenAPI 导入、基础断言、敏感信息本地加密。

价值链：

```text
创建请求 → 配置协议/环境 → Desktop 或 Agent 发送
→ 实时响应 → 保存本地工作区 → 再次执行
```

数据默认：SQLite + 本地文件 + OS Keychain；不强制注册、不依赖服务器。

### P1

WASM 插件、QuickJS 脚本、MQTT/Redis/数据库等协议、Mock、自动化执行、CLI、导入导出增强。

### P2（商业/闭源为主）

用户体系、团队空间、云同步、权限与审计、Java 协作服务、云端协议网关、企业部署。

## P0 近期切片

1. 品牌与产物命名落地（本迭代）
2. Agent 配对令牌 + Origin 校验
3. SQLite 本地项目 / 集合 / 历史
4. 变量解析 `{{var}}` + 基础断言
5. HTTP 契约测试（成功 / 超时 / 取消）
6. OpenAPI 导入骨架
7. Desktop ↔ Agent 版本握手字段

## 脚本生命周期（P0 预留）

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

P0 无脚本：变量替换、JSONPath / Header / Cookie 提取、状态码 / 耗时 / JSON 字段 / 文本包含断言。  
P1 将 QuickJS 挂到同一生命周期，不重构主链路。

## 验收锚点（P0）

- [x] Monorepo 使用 ApiVoy 命名与 Apache-2.0
- [x] `LifecyclePhase` 钩子预留
- [ ] `apivoy-cli http-get` 成功
- [ ] Desktop / Web+Agent HTTP 通路
- [ ] 本地 SQLite 工作区可保存请求
- [ ] Agent 仅本机监听 + 配对授权
