# ApiVoy API 资产架构调整方案

> 状态：Draft
> 目标版本：分阶段交付
> 适用范围：资源管理、API 定义、接口文档、Mock、自动化测试、代码生成及协议插件

## 1. 背景

ApiVoy 已支持 HTTP、GraphQL、gRPC、WebSocket、SSE、TCP、UDP、MQTT、AMQP、Kafka、Redis、SQL、SOAP 和 JSON-RPC 等协议。当前资源树主要围绕集合和请求组织；如果继续直接加入“数据模型”“Proto”“文档”“Mock”等平级节点，会产生以下问题：

- HTTP Schema、Protobuf Message、GraphQL Type 等模型语义不兼容。
- 资源树可能随协议和模型数量增长而迅速膨胀。
- 文档、Mock、测试分别保存请求和响应后容易发生数据漂移。
- 新增协议时需要同时修改资源树、编辑器、文档和 Mock 逻辑。
- 用户难以判断一个模型或示例适用于哪个接口和协议。

本方案不尝试将所有协议强制转换成一种数据模型，而是统一资产外壳、关联关系和能力接口。

## 2. 调整目标

1. 将调试请求与 API 契约分开管理。
2. 让接口文档、Mock、测试和代码生成复用同一份接口与示例数据。
3. 支持有契约和无契约两种工作模式。
4. 允许不同协议声明不同能力，不要求所有协议都有模型或 Mock。
5. 新协议通过注册适配器接入，避免核心 UI 持续增加协议判断。
6. 保持本地优先，定义文件和派生索引可进入版本控制。

## 3. 非目标

- 第一阶段不实现跨协议模型自动转换。
- 不把 OpenAPI、Protobuf、GraphQL 强制映射为无损统一 AST。
- 不要求 TCP、UDP、Redis、SQL 等协议必须支持文档或 Mock。
- 不让生成的文档或 Mock 内容成为另一份独立事实来源。

## 4. 核心原则

### 4.1 契约是源文件，索引是派生数据

OpenAPI、Proto、GraphQL SDL、AsyncAPI 和 WSDL 原文件作为事实来源。系统解析得到统一的接口索引，但不替代原始契约。

### 4.2 示例是多功能复用单元

请求/响应示例同时服务于调试、文档、Mock、测试和代码生成，不在各功能中重复维护。

### 4.3 引用代替复制

调试请求、Mock 场景和测试用例引用 `operationId`、`exampleId` 或 `definitionId`，避免复制整份 Schema。

### 4.4 能力驱动而非协议硬编码

协议通过适配器声明支持解析、校验、示例生成、文档、Mock、Reflection 等能力。

### 4.5 手工请求始终可用

用户可以在没有 OpenAPI 或 Proto 的情况下创建并运行请求，之后再选择绑定契约。

## 5. 目标信息架构

项目级主导航保留跨接口的运行与治理能力，接口自身的定义、示例、文档和 Mock 进入接口工作台：

```text
项目
├─ 资源管理
│  └─ 模块 / 集合 / 接口
├─ 运行集合
├─ 自动化
├─ Mock（跨接口服务与运行状态）
└─ 项目设置
```

资源管理器保持为纯接口导航，避免模型和定义占满左侧树：

```text
资源管理
└─ 用户接口
   ├─ GET 获取用户
   ├─ POST 创建用户
   └─ GRPC GetUser
```

打开具体接口后，在接口工作台顶层使用“调试 / 定义 / 示例 / 文档 / Mock”页签；现有 Params、Headers、Body、Message、Metadata 和 Settings 等协议内页签保留在“调试”中。定义仍以独立实体持久化，但通过接口上下文管理，不在资源树中单独展示。

## 6. 核心领域模型

### 6.1 API 定义

```ts
interface ApiDefinition {
  id: string;
  projectId: string;
  moduleId?: string;
  name: string;
  format: string;
  version?: string;
  rootFileId?: string;
  source: "local" | "import" | "git" | "generated";
  files: DefinitionFile[];
  createdAt: string;
  updatedAt: string;
}

interface DefinitionFile {
  id: string;
  definitionId: string;
  path: string;
  contentRef: string;
  checksum: string;
}
```

大文件正文继续使用现有 Blob/内容引用思路存储，数据库保存元数据和校验和。

### 6.2 接口索引

```ts
interface ApiOperation {
  id: string;
  projectId: string;
  moduleId?: string;
  definitionId?: string;
  protocolId: string;
  operationRef: string;
  name: string;
  summary?: string;
  description?: string;
  tags: string[];
  requestSchemaRef?: string;
  responseSchemaRefs: string[];
  deprecated?: boolean;
}
```

`operationRef` 保持协议内语义：

| 协议 | 示例 |
|---|---|
| HTTP | `GET /users/{id}` |
| gRPC | `user.v1.UserService/GetUser` |
| GraphQL | `Query.user` |
| MQTT/AsyncAPI | `orders/created:publish` |
| SOAP | `UserService/GetUser` |

### 6.3 调试请求绑定

现有 `RequestEnvelope` 保持协议执行数据，增加可选绑定：

```ts
interface OperationBinding {
  definitionId: string;
  operationId: string;
  definitionVersion?: string;
  syncMode: "manual" | "notify" | "follow";
}
```

- `manual`：只记录来源，不自动更新请求。
- `notify`：定义变化时提示差异，推荐默认值。
- `follow`：自动跟随兼容变化，适合生成请求。

### 6.4 示例

```ts
interface ApiExample {
  id: string;
  projectId: string;
  operationId: string;
  name: string;
  request: unknown;
  response: unknown;
  status?: number;
  headers: Array<[string, string]>;
  delayMs?: number;
  tags: string[];
  source: "manual" | "captured" | "generated" | "imported";
}
```

示例可以从实际调用结果保存、从契约生成或从导入文件获得。

### 6.5 Mock 场景

```ts
interface MockScenario {
  id: string;
  projectId: string;
  operationId: string;
  exampleId: string;
  name: string;
  enabled: boolean;
  priority: number;
  match: MockMatchRule;
  behavior?: MockBehavior;
}
```

Mock 场景只保存匹配规则和行为，响应主体引用 `ApiExample`。

### 6.6 文档配置

```ts
interface DocumentationConfig {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  includedOperationIds: string[];
  operationOrder: string[];
  serverRefs: string[];
  environmentRef?: string;
  visibility: "private" | "team" | "public";
  theme?: string;
}
```

文档正文由定义、接口元数据和示例渲染，不复制接口结构。

## 7. 协议能力适配层

```ts
interface ProtocolContractAdapter {
  protocolId: string;
  formats: string[];
  capabilities: ProtocolContractCapabilities;

  parse(files: DefinitionFile[]): Promise<ParsedContract>;
  listOperations(contract: ParsedContract): ApiOperation[];
  validateRequest?(operation: ApiOperation, input: unknown): ValidationResult;
  generateExample?(operation: ApiOperation): ApiExample;
  renderDocumentation?(operation: ApiOperation): DocumentationSection;
  createMockHandler?(operation: ApiOperation, examples: ApiExample[]): MockHandler;
}

interface ProtocolContractCapabilities {
  definition: boolean;
  validation: boolean;
  examples: boolean;
  documentation: boolean;
  mock: boolean;
  codeGeneration: boolean;
  serverReflection?: boolean;
}
```

初始能力矩阵：

| 协议/定义 | 解析 | 校验 | 示例 | 文档 | Mock | Reflection |
|---|---:|---:|---:|---:|---:|---:|
| HTTP/OpenAPI | 是 | 是 | 是 | 是 | 是 | 否 |
| gRPC/Protobuf | 是 | 是 | 是 | 是 | 是 | 是 |
| GraphQL SDL | 是 | 是 | 是 | 是 | 是 | 是 |
| AsyncAPI | 是 | 部分 | 是 | 是 | 部分 | 否 |
| SOAP/WSDL | 是 | 是 | 是 | 是 | 是 | 否 |
| WebSocket（无定义） | 否 | 否 | 手工 | 部分 | 部分 | 否 |
| TCP/UDP | 可选插件 | 可选 | 手工 | 可选 | 暂不支持 | 否 |
| Redis/SQL | 元数据发现 | 部分 | 手工 | 可选 | 暂不支持 | 是 |

核心 UI 只读取能力，不判断具体协议名称。

## 8. 关键业务流程

### 8.1 导入定义

```text
选择文件/目录
→ 检测格式
→ 保存原文件
→ 协议适配器解析
→ 生成 Operation 索引
→ 展示导入差异
→ 可选生成调试请求和示例
```

### 8.2 从请求生成定义

仅对适配器支持的协议开放：

```text
手工 HTTP 请求/响应
→ 推断 Schema
→ 用户确认字段与必填项
→ 新建或合并 OpenAPI 定义
→ 请求绑定新 Operation
```

禁止在没有用户确认时仅根据请求协议自动创建空定义。

### 8.3 文档生成

```text
ApiDefinition
+ ApiOperation 元数据
+ ApiExample
+ DocumentationConfig
→ 文档预览
→ 静态导出或发布
```

定义发生变化时，文档实时更新；删除或破坏性修改需要产生诊断信息。

### 8.4 Mock 自动生成

```text
Operation + Schema
→ 生成默认示例
→ 用户确认/编辑
→ 创建 MockScenario
→ 协议 Mock Adapter 启动路由
```

优先使用用户保存的真实示例，其次使用契约 Example，最后才使用 Schema 随机生成。

### 8.5 自动化测试

测试步骤引用调试请求或 Operation；断言可以引用 Example：

```text
TestCase
├─ operationId/requestId
├─ environmentId
├─ exampleId（可选输入）
└─ assertions（可从响应 Schema 生成）
```

## 9. 前端调整

### 9.1 资源管理器

- 只展示现有模块、集合和接口请求。
- 不展示独立的模型或 API 定义分类。
- 点击接口后进入该接口的生命周期工作台。
- 定义文件、Schema、Message、Enum 和 Service 在接口的“定义”页中按需展示。

### 9.2 接口编辑器

在协议编辑器上方增加统一生命周期页签：

```text
[调试] [定义] [示例] [文档] [Mock]
```

- “调试”承载现有协议编辑器及其内部页签。
- “定义”承载契约关联和 Operation 信息。
- “示例”统一管理请求/响应示例。
- “文档”只保存当前接口的补充描述和展示配置。
- “Mock”管理当前接口的场景，项目级 Mock 工作台负责服务运行。
- 页签由协议能力矩阵决定；TCP/UDP 等协议不显示暂不支持的能力。

契约关联区域包括：

- 未关联、已关联、定义已变化三种状态。
- gRPC 支持选择 Proto Definition 或 Server Reflection。
- HTTP 支持选择 OpenAPI Operation。
- 提供查看差异、重新同步和解除关联操作。

### 9.3 文档和 Mock

- 文档与 Mock 使用项目级独立工作台，不塞入请求树。
- 在接口详情中提供“加入文档”“创建 Mock”“保存为示例”的快捷动作。
- 所有入口最终操作同一组 `operationId` 和 `exampleId`。

## 10. 后端和存储调整

建议在 `local-store` 增加：

- `api_definitions`
- `definition_files`
- `api_operations`
- `api_examples`
- `operation_bindings`
- `mock_scenarios`
- `documentation_configs`

定义解析结果应带 `definition_checksum`。文件变化后在事务中替换 Operation 索引，并记录绑定诊断。

Local Agent 增加建议接口：

```text
GET    /v1/api-definitions
POST   /v1/api-definitions
GET    /v1/api-definitions/:id
PATCH  /v1/api-definitions/:id
DELETE /v1/api-definitions/:id
POST   /v1/api-definitions/:id/files
POST   /v1/api-definitions/:id/reparse
GET    /v1/api-definitions/:id/operations

GET    /v1/operations/:id/examples
POST   /v1/operations/:id/examples
POST   /v1/requests/:id/binding
DELETE /v1/requests/:id/binding
```

`WorkspaceTree` 首屏只返回定义摘要；文件内容和 Operation 详情按需加载。

## 11. 分阶段实施计划

### 阶段 A：信息架构和数据外壳

- 完成所有协议工作台的能力驱动生命周期页签。
- 保持资源树为纯接口导航。
- 移除从请求协议自动推导定义的逻辑。
- 增加定义摘要 DTO、数据库表和 CRUD。
- 完成接口“定义”页中的关联、导入和新建入口。

验收：混合 HTTP/gRPC 项目不会出现虚假定义；导入的定义可以重启后恢复。

### 阶段 B：OpenAPI 与 Protobuf

- 支持单文件和多文件定义。
- 解析 OpenAPI Operation、Schema 引用。
- 解析 Proto Service、Method、Message、Enum 和 import。
- 请求可以绑定 Operation。
- gRPC 保留 Server Reflection 模式。

验收：一份定义可被多个请求复用；定义变化能提示绑定差异。

### 阶段 C：统一示例

- 从调用结果保存 Example。
- 从 OpenAPI/Proto 生成默认 Example。
- 支持请求编辑器加载 Example。
- 增加示例版本和来源标识。

验收：同一 Example 可同时用于调试和后续 Mock/文档。

### 阶段 D：Mock 自动生成

- HTTP Mock 首先落地。
- 支持按路径、参数、Header 和 Body 匹配。
- 从 Example 创建场景。
- 增加延迟、错误、动态变量等行为。
- 后续通过适配器增加 gRPC/GraphQL Mock。

验收：修改 Example 后 Mock 响应同步更新，不复制响应主体。

### 阶段 E：接口文档

- 从 Operation、Schema、Example 生成文档。
- 支持目录、搜索、服务地址和认证说明。
- 支持静态导出和本地预览。
- 发布能力单独控制权限和版本。

验收：定义和示例更新后文档无需手工重复编辑接口结构。

### 阶段 F：测试、代码生成与更多协议

- 从 Operation 和 Example 生成测试骨架。
- 从响应 Schema 生成基础断言。
- 接入 GraphQL、AsyncAPI、WSDL 等适配器。
- 将协议插件能力扩展到定义、文档和 Mock。

## 12. 迁移策略

现有项目不强制迁移：

1. 所有现有请求保持独立、可执行。
2. `operationBinding` 默认为空。
3. 用户导入定义后，由向导匹配现有请求。
4. 匹配结果分为确定、可能和未匹配，必须由用户确认。
5. 现有 Mock 若保存独立响应，迁移为 Example 后再建立 Scenario 引用。
6. 团队快照 Schema 升级时保留旧版本读取能力。

## 13. 风险与控制

| 风险 | 控制措施 |
|---|---|
| 不同协议无法统一 AST | 只统一 Operation 索引，保留协议原始 AST |
| 定义变化导致请求失效 | Checksum、差异诊断和手动确认同步 |
| 大型定义拖慢资源树 | 摘要首屏、文件和 Outline 延迟加载 |
| Mock 随机数据不可重复 | 支持固定 seed，优先使用保存的 Example |
| 文档与运行行为不一致 | 文档引用同一 Operation 和 Example |
| 插件能力失控 | 能力清单、版本契约和缺失能力降级 UI |

## 14. 验收指标

- 混合协议项目中不存在来源不明的模型节点。
- 未导入定义时 API 定义视图为空，不根据请求自动伪造。
- 定义、请求、示例、Mock 和文档之间均使用稳定 ID 引用。
- 同一响应示例不需要在文档、Mock 和测试中重复维护。
- 新协议接入无需修改资源树核心判断逻辑。
- 1,000 个请求和大型多文件定义下，资源树仍按摘要快速加载。
- 定义删除、版本变化和 Operation 消失均有可理解的诊断提示。

## 15. 建议立即执行的下一步

1. 将本方案评审为架构决策，确认“契约 + Operation + Example”主链路。
2. 为 `ApiDefinition`、`DefinitionFile`、`ApiOperation` 建立 Rust 领域类型。
3. 在 `local-store` 增加第一阶段表和迁移。
4. 将当前可选的 `WorkspaceTree.apiDefinitions` 接入真实摘要数据。
5. 优先完成 OpenAPI 与 Protobuf 导入、解析及请求绑定。
6. 在统一 Example 完成前，不继续扩展独立的文档或 Mock 数据模型。
