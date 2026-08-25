# ApiVoy 调试、接口设计与 cURL 导入联动方案

> 状态：Proposed  
> 适用范围：HTTP 接口生命周期，后续扩展至 GraphQL、gRPC  
> 本文中的“同步”特指调试请求与接口设计之间的创建、关联和字段联动，不是云端协作同步。

## 1. 产品结论

调试与设计不能做成两份互相覆盖的完整请求，也不能把任意调试数据自动推断为正式契约。推荐模型是：

```text
Interface（接口资产）
├─ Definition（结构与约束）
└─ Debug Case（可执行值，可有多个）
```

- **设计负责“结构”**：方法、路径、参数位置、字段类型、必填、说明、请求/响应 Schema、安全方案。
- **调试负责“值与运行”**：服务器地址、参数值、Header 值、Cookie 值、Body 示例值、Secret Ref、脚本、断言、超时、代理和 TLS。
- 两者通过稳定的 `interfaceId / operationId` 关联，而不是通过名称、URL 或临时工作台 session ID 关联。
- “同步”默认只把结构变化安全地应用到调试；不会静默删除调试值，也不会把 Token、Cookie 等真实值写进设计。

## 2. 三类创建行为

### 2.1 从调试创建

#### 临时调试

用户点击“新建 HTTP 请求”后，先创建本地临时草稿：

- 不立即创建接口设计。
- 不立即进入资源树。
- 用户可以直接发送请求。
- 首次点击“保存”时进入接口保存流程。

这是必要的，因为大量调试请求是临时验证，不应该污染接口资产和文档。

#### 首次保存

首次保存对话框提供：

```text
保存接口
名称       [获取用户详情            ]
保存到     [项目 / 用户模块         ]

[✓] 根据当前请求生成初始接口设计
    将识别方法、路径、参数、Header 和 JSON Body 结构；
    认证值与敏感数据不会写入设计。

                          [取消] [保存]
```

建议默认勾选“生成初始接口设计”，但记住用户选择。保存必须在一个业务事务内完成：

1. 创建 `Interface`，获得稳定 `interfaceId`。
2. 保存当前调试用例为该接口的默认 Debug Case。
3. 若勾选，执行请求结构推断并创建 Definition。
4. 创建 Definition 与 Interface 的绑定。
5. 任一步失败时不产生“孤儿定义”；至少保证接口和调试请求已经可靠保存，并允许重试生成设计。

#### 已保存接口的后续变化

调试页不应每次保存都自动改设计。提供显式动作：

- `将当前请求更新到设计…`
- 先展示差异：新增参数、类型变化、删除字段、方法/路径变化。
- 默认选中新增项和兼容变化。
- 类型收窄、删除、认证方案变化必须手动确认。
- 参数值只可选择“保存为示例”，不能成为 Schema 默认值。

### 2.2 从设计创建

新建设计时直接创建 `Interface + Definition`。调试请求采用“延迟生成”：

- 用户第一次切换到“调试”页时，从设计生成一个默认 Debug Case 草稿。
- 草稿立即可编辑、可发送；第一次保存后成为正式用例。
- 若设计已经包含 Example，则填入 Example；否则生成类型安全的占位值。
- Server URL 使用设计中的 server，若有多个则让用户选择；没有则保留可编辑的相对路径或默认环境变量。
- 认证只同步方案和位置，不生成真实凭证。

设计保存后的结构变化按照绑定策略作用于调试：

| 变化 | 默认处理 |
|---|---|
| 新增可选参数 | 调试中新增但默认禁用/空值 |
| 新增必填参数 | 新增并标记“待填写” |
| 描述、类型、枚举变化 | 更新约束提示，保留当前值并校验 |
| 参数改名 | 有稳定 fieldId 时迁移原值；否则要求确认 |
| 删除参数 | 标为“设计已删除”，不立即丢弃值 |
| 方法或路径变化 | 更新结构，保留服务器和环境；发送前提示差异 |
| Body Schema 变化 | 三方结构合并，保留仍匹配的用户值 |
| 安全方案变化 | 更新认证控件，不复制或删除 Secret；提示重新绑定 |

每个 Debug Case 可选择绑定模式：

- `跟随设计`：默认。自动应用兼容变化，破坏性变化待确认。
- `仅提醒`：显示差异，由用户点击同步。
- `解除关联`：成为独立请求，不再接收设计变化。

不建议提供“设计每次保存后无条件完全覆盖调试”，它会丢失真实调试值。

### 2.3 从 cURL 导入

cURL 本质是一次具体调用，可信的是“可执行值”，不一定是完整 API 契约。因此解析后必须先进入预览，不自动发送，也不直接生成正式设计。

导入对话框增加“导入为”：

```text
(•) 临时调试请求
( ) 保存为接口，并生成初始设计
( ) 添加为当前接口的调试用例   // 在接口上下文中才出现
```

推荐根据入口设置默认值：

| 入口 | 默认目标 |
|---|---|
| 首页“导入 cURL” | 临时调试请求 |
| 资源树项目/集合“导入 cURL” | 保存为接口，并生成初始设计 |
| 某接口的更多菜单“导入 cURL” | 添加为当前接口的调试用例 |
| 当前调试页“从 cURL 替换” | 只更新当前草稿，保存前显示差异 |

“保存为接口，并生成初始设计”的事务流程与调试首次保存一致；区别是输入来自 cURL 推断。

## 3. 字段归属与同步方向

| 数据 | cURL → 调试 | 调试 → 设计 | 设计 → 调试 |
|---|---:|---:|---:|
| HTTP Method | 直接 | 可确认同步 | 直接同步 |
| Scheme / Host / Port | 直接 | 转为 Server 候选，不写死路径 | 选择 Server/环境 |
| Path | 直接 | 直接或识别路径变量 | 直接同步 |
| Query 参数名 | 直接 | 直接 | 直接同步 |
| Query 参数值 | 直接 | 仅作为 Example，需确认 | Example 或空值 |
| Header 名 | 直接 | 过滤后同步 | 直接同步 |
| Header 值 | 直接但脱敏 | 默认不同步；可存 Example | 不覆盖本地值 |
| Cookie | 直接但敏感提示 | 只同步 Cookie 参数结构 | 不生成真实值 |
| JSON Body | 直接 | 推断 Schema + 可选 Example | 按 Schema 生成/合并 |
| Form / Urlencoded | 解析为字段 | 推断字段结构 | 生成对应 Body 模式 |
| 文件上传 | 保留字段名和文件提示 | 类型为 binary/file | 要求重新选择本地文件 |
| Basic/Bearer/API Key | 识别认证方案 | 只同步 security scheme | 只生成认证控件 |
| Token/密码 | 不持久化明文 | 禁止同步 | 使用 Secret Ref 占位 |
| timeout/retry/proxy/TLS | 直接到调试 | 不属于设计 | 不覆盖调试设置 |
| 脚本/断言 | 不适用 | 不属于设计 | 不覆盖 |
| 响应 Schema | 无 | 从实际响应显式生成 | 用于响应校验 |

以下 Header 默认不进入设计参数：

- `Authorization`：转为安全方案。
- `Cookie`：拆为 Cookie 参数，但值不进入设计。
- `Content-Length`、`Host`、`Connection`、`User-Agent`、`Accept-Encoding`：运行时或客户端 Header。
- `Content-Type`：转为请求体媒体类型。
- `Accept`：转为响应媒体类型候选。

自定义 Header（例如 `X-Tenant-Id`）可进入设计。

## 4. 从调试推断设计的规则

推断结果必须带来源和可信度，避免把一次样本误认为完整契约：

```ts
interface InferredDefinitionField {
  fieldId: string;
  name: string;
  location: "path" | "query" | "header" | "cookie" | "body";
  type: string;
  required: boolean | "unknown";
  example?: unknown;
  confidence: "certain" | "likely" | "guess";
  source: "curl" | "request" | "response";
}
```

规则：

1. 单次请求不能推断 `required=true`；默认 `unknown/false`，由用户确认。
2. JSON 原生 number/boolean/null/array/object 可推断类型；字符串保持 string，不根据长相自动变日期或 UUID，只给格式建议。
3. 空数组只能得到 `array<unknown>`，不猜 items 类型。
4. `null` 只能说明允许空的可能性，不能确定唯一类型。
5. Query、Header、form-data 的值默认是 string；数值和布尔仅作为候选提示。
6. 响应设计只能由实际响应通过“保存为响应示例/生成响应模型”显式创建。
7. 路径变量不应仅凭数字段自动猜测。可提供 `/users/123 → /users/{id}` 建议，由用户确认变量名。

推断预览应展示：

- 将创建的方法与路径。
- 将新增的参数和 Body Schema。
- 被过滤或脱敏的敏感字段。
- 无法可靠推断的字段。
- 是否保存请求/响应 Example。

## 5. 关联模型

建议把现有“Request → Definition”直接绑定调整为接口中心模型：

```ts
interface ApiInterface {
  id: string;
  projectId: string;
  collectionId: string;
  name: string;
  protocolId: "http" | string;
  definitionId?: string;
  operationRef?: string;
}

interface DebugCase {
  id: string;
  interfaceId: string;
  name: string;
  request: RequestEnvelope;
  bindingMode: "follow" | "notify" | "detached";
  appliedDefinitionRevision?: string;
}
```

如果短期不能调整数据库，可兼容实现：

- 将当前资源树 Request 视为 `ApiInterface + 默认 Debug Case`。
- 继续使用 `request_definition_bindings`。
- 必须先保存 Request 获得持久化 ID，再创建并绑定 Definition。
- 禁止使用临时 `session.id` 调用 definition binding API。

## 6. 双向同步算法

### 6.1 设计 → 调试

不要直接用 Definition 重新生成整个请求。应先得到结构差异：

```ts
interface DefinitionDebugDiff {
  additions: FieldChange[];
  updates: FieldChange[];
  removals: FieldChange[];
  methodChange?: ValueChange<string>;
  pathChange?: ValueChange<string>;
  bodyModeChange?: ValueChange<string>;
  securityChange?: SecurityChange;
}
```

应用原则：

- 通过 `fieldId` 匹配，旧数据回退到 `location + normalizedName`。
- 新字段加入调试并记录 `definitionFieldId`。
- 已有字段只更新元信息，不覆盖非空用户值。
- 删除采用软删除提示，用户确认后才移除值。
- JSON Body 按字段树合并，不以字符串整体覆盖。
- 应用成功后记录 `appliedDefinitionRevision`，用于下次计算差异。

### 6.2 调试 → 设计

只在用户触发“更新到设计”时运行：

1. 从当前请求生成 `InferredDefinition`。
2. 与绑定 Definition 按 fieldId/位置+名称比较。
3. 展示差异和风险等级。
4. 用户勾选要应用的结构变化和 Example。
5. 更新设计，但不改变当前调试请求。

风险等级：

- 低：新增可选字段、新增 Example。
- 中：类型扩宽、描述或媒体类型变化。
- 高：删除、改名、必填化、类型收窄、方法/路径、安全方案变化。

## 7. cURL 解析需要补齐的能力

现有解析器已经支持方法、URL、Header、data、cookie、Basic Auth、form 提示、跳转、TLS、代理和超时，但要支撑接口设计联动，还需要：

1. 返回中间表示 `CurlImportModel`，不要直接只返回 `HttpWorkbenchRequest`。
2. 保留每个字段的来源 option 和解析 warning，供预览展示。
3. 正确识别 `Content-Type` 并选择 JSON、urlencoded、form-data、raw、binary Body 模式。
4. 将 `-F name=value` 转为 multipart 字段；文件只保存引用提示，不读取未授权路径。
5. 将 Bearer/API Key Header 识别成 auth scheme，并禁止把真实值写入设计。
6. 支持 `--data @file` 的安全流程：先提示用户明确选择文件，而不是根据命令路径静默读取。
7. 支持多条 cURL 粘贴时逐条预览、命名和选择目标集合。
8. cURL 变量（如 `$TOKEN`、`{{baseUrl}}`）保留为变量表达式，不当作真实 Example。

建议中间结构：

```ts
interface CurlImportModel {
  request: HttpWorkbenchRequest;
  inferredDefinition: InferredHttpDefinition;
  sensitiveFindings: SensitiveFinding[];
  warnings: ImportWarning[];
  unsupportedOptions: string[];
}
```

## 8. 当前实现的具体问题

### `InterfaceLifecycle.tsx`

- `fieldsToDefinition()` 将 HTTP Operation 固定生成成 `GET /current`，未使用当前调试请求的方法和路径。
- `syncDesignToDebug()` 只同步字段和 Body 模式，没有同步 method、path、server 和 security。
- 设计保存后通过 `lastSavedAt` effect 直接 hydrate 调试，用户看不到差异，也无法拒绝破坏性变化。
- `mergeDesignIntoHttpDraft()` 会重新写 `Content-Type`，可能覆盖用户自定义媒体类型。
- 新建设计初始为空，没有从当前调试草稿生成初始 Definition 的入口。
- Definition 先保存、Request 后绑定，临时 session ID 会造成孤儿 Definition 或绑定失败。

### `curlImport.ts / CurlImportDialog.tsx`

- 解析结果只有调试请求和字符串 warning，没有可用于设计推断的中间结构。
- `form-data` 只报警，没有写入 multipart 调试模型。
- Basic Auth 丢弃密码是正确的，但 Bearer/API Key 尚未结构化成认证方案。
- 对话框只有“导入到调试”，没有保存接口、生成设计或添加用例选项。

### `WorkbenchDeck.tsx`

- `createCurlRequest()` 只创建 HTTP 临时 session 并 hydrate。
- 未携带 projectId、collectionId、interfaceId 和 import intent。
- 导入后无法完成“保存请求 + 创建设计 + 绑定”的原子业务流程。

## 9. 建议代码拆分

```text
packages/ui/src/interface-sync/
├─ model.ts                 # Interface、DebugCase、binding、diff 类型
├─ inferHttpDefinition.ts   # 调试/cURL → 设计候选
├─ definitionToDebug.ts     # 设计 → 调试差异与应用
├─ debugToDefinition.ts     # 调试 → 设计差异与应用
├─ sensitiveFields.ts       # Header、Cookie、auth 脱敏规则
└─ *.test.ts

packages/ui/src/import/
├─ curlTokenizer.ts
├─ curlImportModel.ts
└─ CurlImportWizard.tsx
```

不要继续把推断、OpenAPI 序列化、UI 状态和 hydrate 事件堆在 `InterfaceLifecycle.tsx`。

核心业务 API 建议：

```ts
createInterfaceFromDebug(input: {
  projectId: string;
  collectionId: string;
  request: HttpWorkbenchRequest;
  createDefinition: boolean;
  inferenceReview?: InferenceDecision;
}): Promise<{ interfaceId: string; debugCaseId: string; definitionId?: string }>;

createDebugFromDefinition(input: {
  interfaceId: string;
  definitionId: string;
  operationRef: string;
  serverRef?: string;
}): Promise<DebugCase>;

previewInterfaceSync(input: {
  interfaceId: string;
  direction: "definition-to-debug" | "debug-to-definition";
}): Promise<InterfaceSyncPreview>;
```

## 10. 交付顺序

### Phase 1：打通创建闭环

- 调试首次保存增加“生成初始设计”。
- 设计首次进入时增加“从当前调试生成”。
- 确保先持久化 Request，再保存和绑定 Definition。
- Definition 生成使用真实 method/path/bodyMode/security，不再生成 `GET /current`。

验收：从任一侧创建后，资源树中只有一个接口资产，调试与设计均可打开且绑定稳定。

### Phase 2：重做 cURL 导入向导

- 增加三种导入目标和上下文默认值。
- 解析 Body 模式、multipart、认证方案和敏感信息。
- 支持“保存为接口 + 初始设计”的单流程创建。

验收：导入典型 GET、JSON POST、form-data、Basic/Bearer cURL 后，调试可运行，设计结构正确且不含敏感值。

### Phase 3：安全的双向更新

- 引入 fieldId、definition revision 和 diff preview。
- 设计 → 调试自动应用兼容变化。
- 调试 → 设计只做显式审核更新。
- 删除、改名和类型收窄必须确认。

验收：双方来回修改不会重复字段，不会覆盖非空调试值，不会把 Secret 写入设计。

### Phase 4：响应反推与多用例

- 从成功响应保存 Example。
- 显式生成/更新 Response Schema。
- 一个接口支持多个 Debug Case，共享同一 Definition。

## 11. 测试矩阵

至少覆盖：

- 调试 GET + Query → 初始 OpenAPI 方法、路径和参数正确。
- JSON POST → Schema 类型和层级正确，值只进入 Example。
- 设计新增必填字段 → 调试保留旧值并出现待填写字段。
- 设计删除字段 → 调试值不会静默消失。
- 调试更新已有字段值 → 不会修改设计 Schema。
- 调试显式更新设计 → 只应用用户勾选的结构差异。
- cURL Bearer/Basic/API Key → 设计中只有安全方案，无真实凭证。
- cURL form-data 文件 → 设计为 binary，调试要求重新选择本地文件。
- 未保存调试创建定义 → 自动先保存接口，不出现绑定失败。
- 同一接口多个 Debug Case → 设计变化分别计算同步状态。

## 12. 推荐默认行为汇总

| 用户动作 | 推荐默认行为 |
|---|---|
| 新建调试 | 只建临时草稿 |
| 首次保存调试 | 默认勾选生成初始设计 |
| 调试内容后续变化 | 不自动改设计，显式“更新到设计” |
| 新建设计 | 创建接口；首次打开调试时生成默认用例 |
| 设计兼容变化 | 自动合并到“跟随设计”的调试用例 |
| 设计破坏性变化 | 显示差异，确认后应用 |
| 首页导入 cURL | 临时调试 |
| 资源树导入 cURL | 保存接口并生成初始设计 |
| 接口内导入 cURL | 新增调试用例 |
| 敏感值 | 只进入内存或 Secret Ref，不进入设计 |

这套规则兼顾了 Apifox 式“设计与调试围绕同一接口资产”的体验，也保留了 Postman/cURL 常见的快速临时调试能力。

