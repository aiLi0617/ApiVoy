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
| [ISS-010](#iss-010-glib-安全修复被-tauri-gtk3-栈挡住无法自动升级) | glib 安全修复被 Tauri GTK3 栈挡住，无法自动升级 | P2 | open | 2026-08-18 |
| [ISS-011](#iss-011-集合运行按最近修改倒序执行) | 集合运行按最近修改倒序执行 | P1 | open | 2026-08-18 |
| [ISS-012](#iss-012-集合运行忽略所选环境且不递归子集合) | 集合运行忽略所选环境且不递归子集合 | P1 | open | 2026-08-18 |
| [ISS-013](#iss-013-desktopwebcli-集合运行器实现与变量语义分裂) | Desktop/Web/CLI 集合运行器实现与变量语义分裂 | P1 | open | 2026-08-18 |
| [ISS-014](#iss-014-ci-未按路径按需触发) | CI 未按路径按需触发 | P1 | done | 2026-08-18 |
| [ISS-015](#iss-015-release-校验缺少-e2e-与协作服务测试) | Release 校验缺少 E2E 与协作服务测试 | P2 | open | 2026-08-18 |
| [ISS-016](#iss-016-安装包与私有化工作流漏监听-crates) | 安装包与私有化工作流漏监听 crates | P2 | open | 2026-08-18 |
| [ISS-017](#iss-017-协议网关默认绑定全接口) | 协议网关默认绑定 0.0.0.0 | P1 | open | 2026-08-18 |
| [ISS-018](#iss-018-网关-ci-runner-只能执行单条请求) | 网关 CI Runner 只能执行单条请求 | P2 | open | 2026-08-18 |
| [ISS-019](#iss-019-installer-tools-冒烟断言了错误的-health-service-名) | Installer tools 冒烟断言了错误的 health service 名 | P1 | done | 2026-08-26 |
| [ISS-020](#iss-020-传递依赖-h2-安全公告拖红-ci-security) | 传递依赖 h2 安全公告拖红 CI security | P1 | done | 2026-08-26 |
| [ISS-021](#iss-021-codeql-告警未纳入前置审查清单) | CodeQL 告警未纳入前置审查清单 | P1 | done | 2026-08-26 |
| [UX 走查](./UX_WALKTHROUGH.md) | 功能放置与交互（UX-001–055 已关闭） | P0–P2 | done | 2026-08-12 |

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
| **状态** | fixed |
| **模块** | `WorkbenchDeck` / URL 路由 |
| **记录日期** | 2026-08-15 |
| **修复日期** | 2026-08-18 |
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
| **状态** | fixed |
| **模块** | `WorkbenchDeck` / 会话恢复 |
| **记录日期** | 2026-08-15 |
| **修复日期** | 2026-08-18 |
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
| **状态** | fixed |
| **模块** | Playwright E2E |
| **记录日期** | 2026-08-15 |
| **修复日期** | 2026-08-18 |
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

---

## ISS-010 glib 安全修复被 Tauri GTK3 栈挡住，无法自动升级

| 字段 | 内容 |
|------|------|
| **等级** | P2 |
| **状态** | open |
| **模块** | 桌面端 / Tauri / 依赖安全 |
| **记录日期** | 2026-08-18 |
| **关联** | `RUSTSEC-2024-0429`、`.cargo/audit.toml`、`.github/dependabot.yml`、[DEPENDENCY_SECURITY.md](./DEPENDENCY_SECURITY.md) |

### 问题

Dependabot 对 `glib` 报 `security_update_not_possible`：当前解析到 `0.18.5`，无漏洞最低版本是 `0.20.0`。

依赖链为 `apivoy-desktop → Tauri 2 → Wry → gtk 0.18 → glib 0.18.5`。`gtk 0.18` 不能搭配 `glib 0.20`（gtk-rs 大版本不兼容）。单独升级 `glib` 会打断 Linux WebKitGTK 桌面构建。

告警影响的是 `glib::VariantStrIter`。评估结论：ApiVoy 与当前 Tauri/Wry 源码未使用该 API，因此暂列为可接受例外，而不是「无风险、可永久忽略」。

### 当前处理

| 项 | 说明 |
|----|------|
| **cargo audit** | `.cargo/audit.toml` 忽略 `RUSTSEC-2024-0429` |
| **Dependabot** | `.github/dependabot.yml` 忽略 gtk-rs 0.18 一族，避免反复开失败的安全升级 PR |
| **GitHub 告警** | 现有 `glib` Dependabot alert 需在 UI 中标为 tolerable risk / unused code |

### 不要做的

- 不要在当前 Tauri 2 / GTK3 栈上强行把 `glib` 升到 `0.20`。

### 验收标准（真正关闭本单时）

- Tauri / Wry 提供已维护的 Linux GTK 后端（预期 GTK4），且依赖树能解析到 `glib ≥ 0.20`。
- 升级 Tauri 后 Linux 桌面构建与冒烟通过。
- 从 `.cargo/audit.toml`、`.github/dependabot.yml` 和 `DEPENDENCY_SECURITY.md` 移除 glib/GTK3 相关例外。

### 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-18 | 建单；状态 open；等级 P2。记录 Dependabot 无法自动升级的原因与后续升级时机。 |

---

## ISS-011 集合运行按最近修改倒序执行

| 字段 | 内容 |
|------|------|
| **等级** | P1 |
| **状态** | open |
| **模块** | Collection Runner / local-store / Desktop / Web |
| **记录日期** | 2026-08-18 |
| **关联** | `crates/local-store` `list_requests`、`apps/desktop/src-tauri` `run_collection`、`apps/web/src/agentClient.ts` `runCollectionViaAgent` |

### 问题

集合运行的请求顺序来自 `list_requests` 的 `ORDER BY updated_at DESC`。刚编辑过的请求会排到最前，而不是资源树/拖拽后的顺序。

登录拿 token、再调业务接口这类依赖顺序的集合会跑错。CLI `apivoy-cli run` 按 JSON 数组顺序，和 UI 结果对不齐。

### 理想状态

Runner 按树顺序执行：父集合 → 子集合 → 同级 `sort_order`。导出给 CLI 的集合文件使用同一顺序。

### 处理说明

| 项 | 说明 |
|----|------|
| **建议方案** | 请求表增加 `sort_order`（集合表已有）；`list_requests` 与 Runner 改为按该字段；补回归测试：先改最后一条再跑集合，顺序仍为树顺序 |
| **不做的理由** | （暂无） |

### 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-18 | 建单；状态 open；等级 P1 |

---

## ISS-012 集合运行忽略所选环境且不递归子集合

| 字段 | 内容 |
|------|------|
| **等级** | P1 |
| **状态** | open |
| **模块** | Collection Runner / Desktop / Web / Agent |
| **记录日期** | 2026-08-18 |
| **关联** | `run_collection` 写死 `default-env`；`list_requests` 仅 `collection_id = 当前 id`；HTTP 工作台环境选择 |

### 问题

1. **环境**：单次发送会读请求上的 `environmentRef`；Desktop 集合运行始终加载 `default-env`。工作台已选 Staging/Prod 时，点「运行集合」仍打到默认环境。Web 把 envelope 原样交给 Agent，两端行为不一致。
2. **嵌套集合**：资源树支持子集合，运行只查当前 `collection_id`。父集合点运行会跳过子文件夹里的全部请求。

### 理想状态

- Runner 提供「本次运行环境」覆盖；未选时用每条请求自己的 `environmentRef`。
- 默认递归收集子孙请求，可选「仅当前层」。

### 处理说明

| 项 | 说明 |
|----|------|
| **建议方案** | 与 ISS-013 的共享 CollectionRunner 一并做：环境覆盖入参、递归收集、UI 开关 |
| **不做的理由** | （暂无） |

### 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-18 | 建单；状态 open；等级 P1 |

---

## ISS-013 Desktop/Web/CLI 集合运行器实现与变量语义分裂

| 字段 | 内容 |
|------|------|
| **等级** | P1 |
| **状态** | open |
| **模块** | Collection Runner / CLI / Local Agent / 协议网关 |
| **记录日期** | 2026-08-18 |
| **关联** | Desktop `run_collection`、Web `runCollectionViaAgent`、`apps/cli` `run`、ISS-011、ISS-012 |

### 问题

三条通道都叫「跑集合」，实现是三套：

| 通道 | 现状 |
|------|------|
| CLI | 内存 `collection_variables` 跨请求传递，不改落盘环境；支持并发、数据迭代、JSON/JUnit |
| Desktop | 每条独立 `VariableScope`；后置脚本提取的变量写回 `default-env`，污染用户环境 |
| Web | 浏览器 for-loop 调 Agent；关页即停；没有集合级取消；依赖 Agent 写回环境才能「串联」 |

UI Runner 不能取消、不能选环境、不能看逐步进度。网关 `POST /v1/runner/execute` 只跑一条请求（见 ISS-018）。

`PHASE_PLAN` 还计划把 Java `automation` 拆成协作微服务。执行已经在 Rust Engine / Agent / CLI / Gateway，Java 再做一套协议执行会变成第四套。

### 理想状态

抽出共享 Rust `CollectionRunner`：集合变量只在本次 run 内存中传递；环境覆盖显式传入；失败即停 / 并发 / 数据迭代与 CLI 对齐。Agent 增加 `POST /v1/collections/{id}/runs`，Web 不再在浏览器里编排。协作服务继续做 identity / sync / audit，需要远程跑集合时调用 Gateway/Agent。

### 处理说明

| 项 | 说明 |
|----|------|
| **建议方案** | 先修 ISS-011/012 语义，再抽共享 runner；UI 补取消与进度；Gateway CI 改为跑整个 collection |
| **不要做的** | 不要在 Java 协作服务里再实现协议执行引擎 |

### 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-18 | 建单；状态 open；等级 P1 |

---

## ISS-014 CI 未按路径按需触发

| 字段 | 内容 |
|------|------|
| **等级** | P1 |
| **状态** | done |
| **模块** | GitHub Actions / `.github/workflows/ci.yml` |
| **记录日期** | 2026-08-18 |
| **关联** | ISS-015、ISS-016 |

### 问题

CI 在任意 PR 和 `main` 推送上全量跑 TypeScript、Playwright、Cargo、三平台 Desktop、Java。改 README、文档或无关文件也会占用完整 runner 矩阵。

### 理想状态

按改动路径启动对应 job；文档/技能/截图不启动 CI；需要全量时用 `workflow_dispatch`。

### 处理说明

| 项 | 说明 |
|----|------|
| **已做** | `ci.yml` 增加 workflow 级 `paths`；用 `dorny/paths-filter` 拆 `test-js` / `test-e2e` / `test-rust` / `desktop-check` / `security` / `collaboration-server`；聚合 job `CI` 作为闸门；手动运行仍全量 |
| **验证** | 只改 `docs/` 或 `*.md` 时 Actions 不出现 CI；只改协作服务时仅 Java job 运行；Actions 手动 CI 仍跑全部 |
| **后续** | 若开启分支保护，必过检查从旧 `test` 改为聚合 job `CI` |

### 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-18 | 建单并完成按需触发；状态 done |

---

## ISS-015 Release 校验缺少 E2E 与协作服务测试

| 字段 | 内容 |
|------|------|
| **等级** | P2 |
| **状态** | open |
| **模块** | `.github/workflows/release.yml` |
| **记录日期** | 2026-08-18 |
| **关联** | ISS-014、`docs/maintainers/RELEASE.md` |

### 问题

tag `v*` 的 Release `validate` 有 typecheck、单测、`cargo test`、clippy，没有 `pnpm test:e2e`，也没有 `collaboration-server` 的 Gradle 测试。安装包生命周期也不在 tag 上跑。alpha 可能带着坏掉的 Web 冒烟或协作服务发出去。

### 理想状态

Release validate 至少加上 Playwright e2e 与 Gradle test；安装包生命周期对 tag 复用或跑一次。Draft 发布流程保持人工 Publish。

### 处理说明

| 项 | 说明 |
|----|------|
| **建议方案** | `release.yml` `validate` 增加 e2e 与 `./gradlew test`；installer-lifecycle 用 `workflow_call` 或 `push: tags` 接入 |
| **不做的理由** | （暂无） |

### 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-18 | 建单；状态 open；等级 P2 |

---

## ISS-016 安装包与私有化工作流漏监听 crates

| 字段 | 内容 |
|------|------|
| **等级** | P2 |
| **状态** | open |
| **模块** | `.github/workflows/installer-lifecycle.yml` / `private-deploy.yml` |
| **记录日期** | 2026-08-18 |
| **关联** | `deploy/agent.Dockerfile`、`deploy/gateway.Dockerfile`、`deploy/web.Dockerfile` |

### 问题

两条工作流已按路径过滤，但漏了实际影响产物的目录：

- `private-deploy` 镜像 context 是仓库根，Agent/Gateway Dockerfile `COPY crates`，Web 镜像 `COPY packages`。只改 crates/packages 不会重建镜像。
- `installer-lifecycle` 不听 `crates/**`，且没有 `push: main`。核心 crate 变更不会做安装/卸载冒烟。

### 理想状态

路径集合覆盖真实构建输入：`crates/**`、`Cargo.*`、`packages/**`、`pnpm-lock.yaml` 等。installer-lifecycle 在 `main` 或 tag 上再跑一次。

### 处理说明

| 项 | 说明 |
|----|------|
| **建议方案** | 按 Dockerfile / Tauri 构建输入补 `paths`；避免再对文档触发 |
| **不做的理由** | （暂无） |

### 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-18 | 建单；状态 open；等级 P2 |

---

## ISS-017 协议网关默认绑定全接口

| 字段 | 内容 |
|------|------|
| **等级** | P1 |
| **状态** | open |
| **模块** | protocol-gateway / 威胁模型 |
| **记录日期** | 2026-08-18 |
| **关联** | `apps/protocol-gateway/src/main.rs` `APIVOY_GATEWAY_BIND`、AGENTS.md「默认不远程绑定」、`docs/THREAT_MODEL.md` |

### 问题

Local Agent 默认 `127.0.0.1:39217`。协议网关默认 `0.0.0.0:39218`。本机 `cargo run -p apivoy-protocol-gateway` 会把远程执行口暴露到局域网。

Compose 里绑 `0.0.0.0` 合理（容器内、前面有 Nginx）。二进制默认值不应与 Agent / AGENTS.md 相反。

定时任务把完整 `RequestEnvelope` 落到 `jobs.json`，文档写了「不要明文」，代码没有敏感扫描。

### 理想状态

二进制默认 `127.0.0.1:39218`；`deploy/compose.yaml` 显式设 `0.0.0.0`。创建/持久化 job 时扫描敏感字段。

### 处理说明

| 项 | 说明 |
|----|------|
| **建议方案** | 改默认 bind；补单测；job 落盘前做与导出相同的敏感扫描 |
| **风险** | 已依赖默认全接口的私有化脚本需改环境变量（Compose 已显式设置，不受影响） |

### 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-18 | 建单；状态 open；等级 P1 |

---

## ISS-018 网关 CI Runner 只能执行单条请求

| 字段 | 内容 |
|------|------|
| **等级** | P2 |
| **状态** | open |
| **模块** | protocol-gateway / CLI |
| **记录日期** | 2026-08-18 |
| **关联** | `POST /v1/runner/execute`、ISS-013、`docs/guides/cli-collections.md` |

### 问题

网关宣传 `modes: ["remote","scheduled","ci"]`，但 CI 入口只接收一条 `RequestEnvelope` 和 `failOnAssertion`。不能跑 ApiVoy 集合、不能数据迭代、退出码语义与 `apivoy-cli run` 不完全对齐。

### 理想状态

Gateway CI 接收 collection（或项目包），复用共享 CollectionRunner，退出码与 CLI 一致。

### 处理说明

| 项 | 说明 |
|----|------|
| **建议方案** | 依赖 ISS-013 的共享 runner；保留现有单条接口做兼容，新增 collection 入口 |
| **不做的理由** | （暂无） |

### 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-18 | 建单；状态 open；等级 P2 |

---

## ISS-019 Installer tools 冒烟断言了错误的 health service 名

| 字段 | 内容 |
|------|------|
| **等级** | P1 |
| **状态** | done |
| **模块** | `.github/workflows/installer-lifecycle.yml` / Local Agent `/health` |
| **记录日期** | 2026-08-26 |
| **关联** | [PR_REVIEW_CHECKLIST.md](./maintainers/PR_REVIEW_CHECKLIST.md) §3、`apps/local-agent` |

### 问题

`tools` job 编译与安装成功后，用 `grep` / PowerShell 断言 health 含 `apivoy-local-agent`。实际 JSON 为 `"service":"apivoy-agent"`（crate 包名 ≠ 二进制名 ≠ health 字段）。三平台 tools 全红，易被误判为 Agent 起不来。

### 理想状态

契约单一：文档、冒烟、工作流都断言 `apivoy-agent`；改字段时同步清单 §3。

### 处理说明

| 项 | 说明 |
|----|------|
| **已做** | 修正 installer-lifecycle Unix/Windows 断言；SMOKE_CHECKLIST 写明期望字段；审查清单 §3 前置 |
| **验证** | tools job 在 health 就绪后应通过字段断言 |

### 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-26 | 建单并修复；状态 done |

---

## ISS-020 传递依赖 h2 安全公告拖红 CI security

| 字段 | 内容 |
|------|------|
| **等级** | P1 |
| **状态** | done |
| **模块** | `Cargo.lock` / CI `security` / `cargo audit` |
| **记录日期** | 2026-08-26 |
| **关联** | `RUSTSEC-2026-0258`、[DEPENDENCY_SECURITY.md](./DEPENDENCY_SECURITY.md)、审查清单 §1 |

### 问题

`h2 0.4.15`（经 `reqwest`/`hyper`）触发 `RUSTSEC-2026-0258`，`cargo audit -D warnings` 失败，聚合 job `CI` 变红。业务代码未改也会被 lockfile 拖红。

### 理想状态

改 Rust 依赖或 lockfile 时本地先跑 `cargo audit`；能升级则升级，不把新 advisory 默默加入 ignore。

### 处理说明

| 项 | 说明 |
|----|------|
| **已做** | `cargo update -p h2 --precise 0.4.16`；审查清单要求触及 lockfile 时本地 audit |
| **验证** | `cargo audit -D warnings` 通过；CI `security` 绿 |

### 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-26 | 建单并修复；状态 done |

---

## ISS-021 CodeQL 告警未纳入前置审查清单

| 字段 | 内容 |
|------|------|
| **等级** | P1 |
| **状态** | done |
| **模块** | `packages/ui` / `packages/import-export` / GitHub CodeQL |
| **记录日期** | 2026-08-26 |
| **关联** | [PR_REVIEW_CHECKLIST.md](./maintainers/PR_REVIEW_CHECKLIST.md) §2 |

### 问题

PR 上 Analyze 子任务全绿，但 CodeQL 门禁因「new alerts」失败。本轮典型项：

- `DOMParser.parseFromString` → client XSS（TCP XML 校验）
- 链式 HTML 实体解码 → double-escaping
- OpenAPI `{var}` 正则替换 → polynomial ReDoS
- `setAtPath` 写入 `__proto__` 等 → prototype pollution

这些本可在审查阶段按模式扫出，却拖到 PR Checks。

### 理想状态

UI/导入/路径写入变更按审查清单 §2 自查；Codex/维护者审查引用同一清单；新「只在 CodeQL 才发现」的模式补回清单。

### 处理说明

| 项 | 说明 |
|----|------|
| **已做** | 修复上述四处实现；新增 `docs/maintainers/PR_REVIEW_CHECKLIST.md`；PR 模板与 CONTRIBUTING/AGENTS 引用 |
| **验证** | 相关单测通过；等待 CodeQL 门禁对新 commit 转绿 |

### 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-26 | 建单、修复并落审查清单；状态 done |
