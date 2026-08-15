# ApiVoy 问题与改进记录

> 记录已知产品/部署摩擦、理想状态、处理状态与等级。  
> 功能放置与交互走查见 **[UX_WALKTHROUGH.md](./UX_WALKTHROUGH.md)**（UX-001…）。  
> 状态：`open` 未处理 · `planned` 已排期 · `in_progress` 进行中 · `done` 已关闭 · `wontfix` 不处理  
> 等级：`P0` 阻塞可用 · `P1` 高优先体验/安全 · `P2` 应改进 · `P3` 锦上添花

---

## 索引

| ID | 标题 | 等级 | 状态 | 更新日期 |
|----|------|------|------|----------|
| [ISS-001](#iss-001-协作引导令牌需人工生成与配置) | 协作引导令牌需人工生成与配置 | P2 | open | 2026-08-12 |
| [ISS-002](#iss-002-请求响应左右分栏不便查看) | 请求/响应左右分栏不便查看 | P1 | done | 2026-08-12 |
| [ISS-003](#iss-003-窄屏下主工作区被压缩为侧栏宽度) | 窄屏下主工作区被压缩为侧栏宽度 | P0 | open | 2026-08-15 |
| [ISS-004](#iss-004-workbench-直达链接被项目主页吞掉) | Workbench 直达链接被项目主页吞掉 | P1 | open | 2026-08-15 |
| [ISS-005](#iss-005-workbench-会话刷新后丢失) | Workbench 会话刷新后丢失 | P1 | open | 2026-08-15 |
| [ISS-006](#iss-006-冒烟测试未实际覆盖工作台页面) | 冒烟测试未实际覆盖工作台页面 | P1 | open | 2026-08-15 |
| [ISS-007](#iss-007-local-agent-失败态暴露原始错误和内部-id) | Local Agent 失败态暴露原始错误和内部 ID | P2 | open | 2026-08-15 |
| [ISS-008](#iss-008-首页形成嵌套-main-landmark) | 首页形成嵌套 main landmark | P2 | open | 2026-08-15 |
| [ISS-009](#iss-009-wss-执行因-rustls-cryptoprovider-未初始化而崩溃) | WSS 执行因 Rustls CryptoProvider 未初始化而崩溃 | P0 | done | 2026-08-15 |
| [UX 走查](./UX_WALKTHROUGH.md) | 功能放置与交互（23 项，多数 open） | P0–P2 | open | 2026-08-12 |

---

## ISS-001 协作引导令牌需人工生成与配置

| 字段 | 内容 |
|------|------|
| **等级** | P2 |
| **状态** | open |
| **模块** | collaboration-server / Team 首次引导 / 私有化部署 |
| **记录日期** | 2026-08-12 |
| **关联** | `APIVOY_COLLAB_BOOTSTRAP_TOKEN` / `APIVOY_BOOTSTRAP_TOKEN`、`POST /v1/auth/bootstrap`、Team「首次引导」 |

### 问题

创建首位 Owner 依赖「引导令牌」，但：

- 客户端（Team / SSO）**没有获取入口**，只能运维侧自己生成后粘贴进表单
- 本地开发、Docker 私有化都要先写环境变量，再在 UI 里手动对齐同一串值
- 默认占位（如 `change-me-before-production`）容易被误当成正式值，或让人以为「系统里某处能看见令牌」

不装协作服务、不做团队同步时不受影响；一旦要引导 Owner，摩擦明显。

### 当前生成方式

| 场景 | 现状 |
|------|------|
| 本地 `bootRun` | 自行设置 `APIVOY_COLLAB_BOOTSTRAP_TOKEN` |
| `deploy/.env` | 自行填写 `APIVOY_BOOTSTRAP_TOKEN`（从 `.env.example` 拷贝占位后替换） |
| UI | 仅输入框，无生成、无展示、无一键复制 |

令牌**不会**由 App 下发；服务端只校验请求头 `X-ApiVoy-Bootstrap-Token` 与配置是否一致，且库中已有用户后引导永久关闭。

### 理想状态

**部署（或首次空库启动）后自动生成引导凭证，运维/本机开发尽量不用手写配置。** 例如：

1. 空库首次启动时自动生成高熵一次性令牌（或 setup 链接）
2. **只输出一次**到启动日志 / 部署结果（或本机安全落盘），供创建 Owner 使用
3. UI 探测 `bootstrap` 是否仍可用；本机 `localhost` 可进一步免填或自动带上
4. 公网/生产仍保证：未完成引导前外人猜不到；完成后接口失效，无需长期保管该令牌

日常仅使用 Desktop/Web 本地能力时，继续**完全不涉及**该令牌。

### 处理说明

| 项 | 说明 |
|----|------|
| **建议方案** | 启动时若未配置或为占位值且用户数为 0 → 自动生成并日志打印；提供 `GET /v1/auth/bootstrap-status`；Team 引导表单按状态显隐；可选 localhost 免令牌 |
| **风险** | 自动生成若绑定 `0.0.0.0` 且无其它防护，存在窗口期被抢注 Owner 的风险，需限制为本地回环或必须读到启动输出 |
| **不做的理由** | （暂无；保留至方案落地或降级为文档-only） |

### 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-12 | 建单；状态 open；等级 P2 |

---

## ISS-002 请求/响应左右分栏不便查看

| 字段 | 内容 |
|------|------|
| **等级** | P1 |
| **状态** | done |
| **模块** | `SplitPane` / HTTP 工作台 |
| **记录日期** | 2026-08-12 |
| **关联** | `WorkbenchFrame.tsx`、`HttpWorkbench.tsx`、`styles.css` |

### 问题

请求配置与响应内容默认左右分栏。在资源管理器 + 协议导航已占用横向空间时，两侧都过窄，响应正文（JSON/长文本）阅读体验差。

### 理想状态

默认以上下分栏阅读响应；需要时再切左右；宽屏「自动」模式仅在足够宽时用左右。

### 处理说明

| 项 | 说明 |
|----|------|
| **已做** | 默认改为上下；增加「上下 / 左右 / 自动」切换并持久化；`auto` 在 &lt;1600px 保持上下，≥1600px 才左右 |
| **验证** | HTTP 工作台发送请求后可完整纵向浏览响应；工具条可切回左右 |

### 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-12 | 建单并完成；状态 done；等级 P1 |

---

## ISS-003 窄屏下主工作区被压缩为侧栏宽度

| 字段 | 内容 |
|------|------|
| **等级** | P0 |
| **状态** | open |
| **模块** | `WorkbenchDeck` / 响应式布局 |
| **记录日期** | 2026-08-15 |
| **关联** | `packages/ui/src/styles.css:72-73,181-190` |

### 问题

当视口宽度不超过 1024px 时，`.workbench-deck` 被改为 `52px minmax(0,1fr)` 两列，但 `.protocol-nav` 仍由基础规则 `display:none` 隐藏。CSS Grid 自动布局因而把唯一可见的 `.workbench-content` 放进第一列，主内容只剩约 52px。

在 412×915 视口实测：首页内容宽度仅约 43px，文字逐字换行，右侧约 360px 全部空白；页面没有水平滚动条，因此用户也无法滚动到被空置的区域。首页与所有工作台在手机和小尺寸平板上基本不可用。

### 复现

1. 启动 Web 端并打开任意页面。
2. 将视口缩至 1024px 或更窄（412×915 可稳定复现）。
3. 观察项目主页或打开任意工作台。

### 验收标准

- 隐藏协议导航时，工作台必须使用单列 `minmax(0,1fr)`。
- 若产品决定在该断点显示 52px 导航，则需显式恢复 `.protocol-nav` 的布局，并保证主内容落在第二列。
- 在 375、412、768、1024px 四个宽度下，主内容占满剩余宽度，无非预期横向溢出或大面积空白。

---

## ISS-004 Workbench 直达链接被项目主页吞掉

| 字段 | 内容 |
|------|------|
| **等级** | P1 |
| **状态** | open |
| **模块** | `WorkbenchDeck` / URL 路由 |
| **记录日期** | 2026-08-15 |
| **关联** | `packages/ui/src/WorkbenchDeck.tsx:57-60`、`apps/web/src/App.tsx:138` |

### 问题

访问 `/#workbench=http`、`/#workbench=redis` 等地址时仍显示“项目主页”，没有创建或激活 URL 指定的工作台。`WorkbenchDeck` 虽然解析了 `hashWorkbench()`，但 Web 端传入 `startOnHome={!selectedRequestId}` 后，无请求 ID 时会无条件把 `sessions` 初始化为空。

这使书签、刷新、外部分享和测试用的协议直达链接失效；URL 看起来已选择工作台，实际界面状态却不一致。

### 验收标准

- URL 存在合法 `workbench` 参数时，优先创建并激活对应会话。
- 只有 URL、已保存状态和待打开请求都未指定工作台时才显示项目主页。
- 非法 workbench ID 应回退首页，并给出可理解的状态，而不是保留误导性 URL。

---

## ISS-005 Workbench 会话刷新后丢失

| 字段 | 内容 |
|------|------|
| **等级** | P1 |
| **状态** | open |
| **模块** | `WorkbenchDeck` / 会话恢复 |
| **记录日期** | 2026-08-15 |
| **关联** | `packages/ui/src/WorkbenchDeck.tsx:57-60`、`packages/ui/src/appStore.ts` |

### 问题

用户打开 Redis、HTTP 等工作台后，活动工作台会写入 URL 和 `apivoy:ui-state`；刷新页面却重新回到项目主页，已打开会话全部丢失。当前只持久化了活动工作台类型，没有恢复会话的逻辑，且 `startOnHome` 会覆盖 URL/存储状态。

### 验收标准

- 至少恢复刷新前的活动工作台；若产品承诺多标签会话恢复，则同时恢复标签顺序和标题。
- 刷新后 URL、持久化状态、选中标签三者一致。
- 新用户首次进入且无任何状态时仍进入项目主页。

---

## ISS-006 冒烟测试未实际覆盖工作台页面

| 字段 | 内容 |
|------|------|
| **等级** | P1 |
| **状态** | open |
| **模块** | Playwright E2E |
| **记录日期** | 2026-08-15 |
| **关联** | `e2e/web-smoke.spec.ts` |

### 问题

现有测试依赖 `/#workbench=...` 进入工作台，但该路由当前实际停留在项目主页。14 项测试中有 10 项失败；另外“所有协议工作台在浅色主题下无横向溢出”两端均通过，但它只测到了首页宽度，没有断言 `.workbench-frame` 可见，属于假通过。

本次结果：桌面与移动项目合计 **4 passed / 10 failed**。失败集中在工作台标签、HTTP URL 输入框、语义 frame 和刷新恢复均不存在。

### 验收标准

- 每个循环用例先断言指定工作台标题或 `data-testid` 已出现，再检查布局。
- 路由失败时测试应立即失败，不得只以 `documentElement.scrollWidth` 判定工作台通过。
- 增加 1024px、768px、412px 的回归视口，覆盖 ISS-003。

---

## ISS-007 Local Agent 失败态暴露原始错误和内部 ID

| 字段 | 内容 |
|------|------|
| **等级** | P2 |
| **状态** | open |
| **模块** | Web 首页 / 资源管理器错误态 |
| **记录日期** | 2026-08-15 |
| **关联** | `apps/web/src/App.tsx:77-105`、`WorkbenchDeck` 首页 |

### 问题

Local Agent 未启动时，左侧错误卡直接显示英文底层错误 `Failed to fetch`；首页同时显示保存位置 `default-project / default-collection`。这是内部错误文本和内部 ID，不足以告诉用户需要启动 Agent、检查端口还是完成配对，也会让用户误以为这两个默认 ID 是真实项目名称。

### 验收标准

- 将网络不可达、超时、未配对分别映射为中文且可操作的说明。
- 工作区树未加载成功时，不显示内部默认 ID；改为“工作区尚未加载”或隐藏保存位置。
- “检查 Local Agent 设置”应能直达对应设置项，并保留重试入口。

---

## ISS-008 首页形成嵌套 main landmark

| 字段 | 内容 |
|------|------|
| **等级** | P2 |
| **状态** | open |
| **模块** | `AppShell` / `WorkbenchDeck` / 可访问性 |
| **记录日期** | 2026-08-15 |
| **关联** | `packages/ui/src/WorkbenchDeck.tsx:236` |

### 问题

应用壳层已经使用 `<main id="apivoy-main">`，项目主页又在内部渲染一个 `<main class="workbench-home">`，形成嵌套 main landmark。屏幕阅读器的主区域导航会出现歧义，也违反 main landmark 不应嵌套的通用语义约束。

### 验收标准

- 页面只保留一个顶级 `main` landmark。
- 首页容器改用 `section`/`div`，并通过 `aria-labelledby="workbench-home-title"` 保留可识别名称。
- 为首页补充自动化可访问性断言。

---

## ISS-009 WSS 执行因 Rustls CryptoProvider 未初始化而崩溃

| 字段 | 内容 |
|------|------|
| **等级** | P0 |
| **状态** | done |
| **模块** | Local Agent / WebSocket / TLS / 错误传播 |
| **记录日期** | 2026-08-15 |
| **关联** | `crates/driver-websocket`、`apps/local-agent/src/main.rs:1756-1828`、`apps/web/src/agentClient.ts:525-540` |

### 问题

通过 Local Agent 连接 `wss://ws.postman-echo.com/raw` 时，执行任务在 Rustls 初始化阶段 panic：`Could not automatically determine the process-level CryptoProvider from Rustls crate features`。当前依赖组合同时或错误启用了 Rustls provider，且 Agent 启动时未显式调用 `CryptoProvider::install_default()`。

任务 panic 后，Local Agent 只记录 `execution task join error`，没有向 SSE 客户端发送 `failed` 事件；Web 端因既没有 `summary` 也没有 `error`，最终显示 `execution finished without summary`，掩盖了真实故障。

### 复现

1. 启动当前 Local Agent 和 Web 端。
2. 在 WebSocket 工作台输入 `wss://ws.postman-echo.com/raw`。
3. 点击“连接并发送”或“建立连接”。
4. UI 显示 `execution finished without summary`；Agent 日志出现 Rustls CryptoProvider panic。

### 验收标准

- Cargo 依赖只选择一个 Rustls provider，或在 Agent 进程入口显式安装选定 provider。
- WSS 握手成功，能够向 Echo 服务发送并接收文本帧。
- 所有执行任务 panic/join error 都转换为结构化 `failed` 事件，前端不得再以 `execution finished without summary` 代替真实错误。
- 增加 WSS 成功、TLS 初始化失败和执行任务 panic 的回归测试。

### 处理说明

- 移除 `lapin` 重复启用的通用 `rustls` feature，统一使用 `rustls--ring`；Local Agent 依赖树不再同时包含 AWS-LC 与 Ring provider。
- `ExecutionEngine::new()` 显式安装 Ring Provider，为 Agent、Desktop、Gateway 和 CLI 提供进程级兜底，避免未来的依赖 feature 变化再次触发 provider 推断 panic。
- Local Agent 在执行任务异常退出时发送 `execution_task_panicked` 和 Failed 状态，再关闭 SSE，前端可以展示真实故障。
- `cargo check -p apivoy-local-agent -p driver-websocket -p driver-amqp` 通过。
- WebSocket 与 AMQP 驱动单测共 4 项通过。
- 隔离构建的新 Agent 已对 `wss://ws.postman-echo.com/raw` 完成端到端测试：握手状态 101，成功回显 `hello from ApiVoy`，执行状态 completed。
