# ApiVoy 全项目 UI/UX 问题审计表

> 审计日期：2026-08-31
>
> 文档状态：运行时深度审计完成 / 待产品与研发确认
>
> 审计对象：`apps/web`、`apps/desktop` 共用的 `packages/ui` 界面
>
> 问题状态：`open` 未处理 · `planned` 已排期 · `in_progress` 处理中 · `done` 已验收 · `wontfix` 不处理

## 1. 结论

ApiVoy 已经具备深浅主题、语义令牌、共享壳层、资源树、命令面板、分栏、Toast/Dialog、部分长列表虚拟化等良好基础。当前主要矛盾不是“缺少设计方向”，而是**共享设计系统只在壳层、HTTP 与少量新组件中落地较深，其余协议、工具和协作工作台仍保留大量私有视觉与交互实现**。

本轮共记录 46 项问题：P1 23 项、P2 23 项，暂无阻断产品使用的 P0。结果来自静态代码、真实 Chromium 逐页操作、桌面/移动截图、深浅主题、语言偏好、键盘路径和自动对比度扫描，不再只是代码推断。建议先完成交互与可访问性基线，再统一图标、组件和视觉细节，最后补齐跨页面回归。

| 等级 | 定义 | 数量 | 建议处理窗口 |
|---|---|---:|---|
| P0 | 阻断核心任务、数据安全或平台可用性 | 0 | 立即 |
| P1 | 明显影响任务完成、跨页面一致性或可访问性 | 23 | 下一版本优先 |
| P2 | 影响效率、理解成本、视觉品质或长期维护 | 23 | 随后 1–2 个版本 |
| P3 | 锦上添花 | 0 | 机会项 |

## 2. 审计范围与方法

### 2.1 覆盖范围

- 应用壳层：顶部栏、项目入口、资源管理器、工作台标签、命令面板、设置、协作入口；
- API：HTTP、gRPC、SOAP / JSON-RPC；
- 实时通信：WebSocket、SSE、TCP、UDP；
- 消息：MQTT、AMQP、Kafka；
- 数据：Redis、SQL；
- 工具：Mock、Runner、Gateway、Capture、Plugins、AI；
- 协作：Team、Comments、SSO；
- 设计基础：图标、颜色、字体、间距、响应式、状态反馈、键盘和读屏语义。

### 2.2 证据来源

- 代码走查：`packages/ui/src` 中 44 个 TSX 文件和 4 份主要样式文件；
- 现有规范：`docs/UI_UX_DESIGN_SYSTEM.md`、`docs/UX_WALKTHROUGH.md`、`docs/BRANDING.md`；
- 视觉样本：`docs/images/overview.png`、`docs/images/protocol-list.png` 及 `output/playwright` 中现有截图；
- 自动盘点结果：26/44 个 TSX 文件包含内联样式，共 532 处；CSS 中 `9px` 字号 41 处、`10px` 字号 120 处、硬编码 `z-index` 27 处；117 个按钮未显式声明 `type`；现有 4 个 E2E spec 主要集中在 Web smoke 与响应校验。

### 2.3 运行时深度验证

使用真实 Chromium 对 17 个工作台逐一隔离加载并保存截图，覆盖：

| 矩阵 | 覆盖 | 结果摘要 | 证据目录 |
|---|---|---|---|
| 1440×900、深色、中文 | HTTP 至 AI 共 17 个工作台 | 无文档级横向滚动；每页仍有 10–34 个低于 36px 的交互目标；除 HTTP 外，多数工作台 Tab 全部进入 Tab 顺序 | `output/playwright/deep-ui-ux-audit/isolated-desktop-dark-zh-*.png` |
| 375×812、浅色、英文偏好 | HTTP 至 AI 共 17 个工作台 | 每页有 10–36 个低于 44px 的交互目标；HTTP/SSE/WebSocket 存在内部内容裁切；语言偏好未完整生效 | `output/playwright/deep-ui-ux-audit/isolated-mobile-light-en-*.png` |
| 1440×900、浅色、英文偏好 | Gateway、Capture、AI、MQTT、Redis | 私有表面未随主题迁移；最低扫描对比度约 1.06:1；大量正文与表单标签低于 4.5:1 | `output/playwright/deep-ui-ux-audit/isolated-desktop-light-en-*.png` |
| 键盘与交互路径 | WebSocket Tab、自动化、项目设置、克隆项目 | WebSocket 方向键切换失败；自动化与克隆为假入口；项目设置焦点进入与 Escape 关闭通过 | `.playwright-cli` 快照与截图 |

自动对比度扫描为 DOM/CSS 计算值，用于定位风险，不替代最终人工 WCAG 验收。已实测的高风险样本包括：Gateway 约 1.12–1.48:1、Capture 约 1.06–2.04:1、AI 表单标签约 1.74:1、MQTT/Redis 表单标签约 1.79–1.80:1。

### 2.4 审查基线

产品应保持“IDE + 高密度数据工作台”的专业开发者工具形态：深色优先但完整支持浅色；正文与关键元数据可读；执行、连接、失败和危险状态清楚且不只依赖颜色；主任务位置稳定；SVG 图标语义统一；键盘、读屏和小屏均能完成核心流程。

## 3. 问题总表

| ID | 等级 | 范围 | 维度 | 问题与影响 | 代码 / 视觉证据 | 建议方案 | 状态 |
|---|---|---|---|---|---|---|---|
| UIA-001 | P1 | 全局 | 设计系统 | 工作台组件迁移不完整，壳层与 HTTP 较统一，但工具、消息、协作页面仍各自维护按钮、卡片、表单和状态样式，跨页观感与交互反馈明显分叉。 | 26/44 个 TSX 文件、532 处 `style={...}`；`TeamWorkbench.tsx` 66 处、`GatewayWorkbench.tsx` 36 处、`AiWorkbench.tsx` 31 处。 | 建立 `Button`、`Field`、`SegmentedControl`、`StatusBadge`、`DataPanel`、`Toolbar` 等共享组件；按工作台族逐步迁移，禁止新增页面私有基础控件。 | open |
| UIA-002 | P1 | 全局 | 国际化 | 中英文切换只覆盖壳层的一部分，工作台正文大量硬编码中文或英文，同一页面出现 `Send / Save / Waiting for response` 与中文标签混排。 | 运行时设置 `en-US` 后，壳层变英文，但项目侧轨、生命周期、WebSocket 正文仍为中文；`i18n.ts`、`WebSocketWorkbench.tsx:212-221`；`isolated-mobile-light-en-http.png`。 | 将所有用户可见文本迁入命名空间化词典；CI 增加 JSX 硬编码文本检查；术语保留协议名，操作与说明随 locale 切换。 | open |
| UIA-003 | P1 | 导航、命令面板、标签页 | 图标 | 多种协议与工作台共用 `bolt` 图标，用户无法通过轮廓快速识别 HTTP、gRPC、MQTT、Kafka、AI、自动化等入口。 | `AppShell.tsx:99,351`、`AppShell.tsx:365`、工作台标签与命令面板；`Icons.tsx` 仅 40 个左右通用图标；`docs/images/protocol-list.png`。 | 为每个协议建立唯一图标映射；同一协议在新建菜单、标签、命令面板、资源树中复用同一图标与颜色辅助标识。 | open |
| UIA-004 | P2 | 全局 | 图标 | 部分控件和状态继续使用字符代替图标，如 `•••`、`←/→`、`✓`、`●/○`；字形随字体和平台变化，尺寸与基线难统一。 | `WebSocketWorkbench.tsx:225-226`、`CaptureWorkbench.tsx:14`。 | 控件使用统一 SVG；消息方向和状态可保留文本含义，但应由 `aria-label`、图标和文字共同表达。 | open |
| UIA-005 | P1 | 全局、小屏 | 可访问性 | 高频按钮和图标按钮普遍只有 22–34px，低于触控环境建议的 44×44px；移动端容易误触。 | 运行时统计：桌面每页 10–34 个目标低于 36px；移动端每页 10–36 个目标低于 44px；`styles.css:58-60,112,119,157,165,384,415,500-509,1024,1034`。 | 桌面视觉可保持紧凑，但交互命中区用伪元素或 padding 扩至至少 36px；`max-width: 768px` 下统一到至少 44px。 | open |
| UIA-006 | P1 | 全局 | 可读性 | 9–10px 字号使用过多，弱色文本、说明、元数据和表头在常见 Windows 缩放与浅色主题下阅读成本高。 | CSS 中 9px 41 处、10px 120 处；运行时每页可见小字号文本 15–28 处；浅色对比度扫描出现多项低于 4.5:1。 | 正文/控件最低 12px，辅助信息最低 11px；仅非关键信息允许 10px；结合 WCAG 对比度工具逐主题验收。 | open |
| UIA-007 | P1 | 协议导航 | 键盘可达性 | 未收藏协议的星标按钮默认 `color: transparent`，仅 hover 或已收藏时显色；键盘聚焦时可能只看到空焦点框。 | `styles.css:119-121`、`WorkbenchDeck.tsx:352`。 | 增加 `.favorite-button:focus-visible` 显色；在触屏/无 hover 环境保持可发现；补键盘收藏回归测试。 | open |
| UIA-008 | P2 | 全局 | 主题 | 仍存在页面私有硬编码颜色，绕过语义令牌，浅色主题和未来品牌调整容易出现局部失配。 | `styles.css:43,126` 及多个工作台 `CSSProperties` 中的 `#...` / `rgba(...)`。 | 补齐 `--surface-*`、`--text-*`、`--action-*`、`--status-*` 令牌；业务组件禁止直接写颜色值。 | open |
| UIA-009 | P2 | 浮层、菜单 | 层级 | 设计系统定义了 z-index 令牌，但实现中仍有 27 处数字层级，出现 80、90 等超出规范的值，后续容易发生浮层互相遮挡。 | `styles.css:98,143,153,254,383,404,470,506` 等。 | 只允许 `--z-header / dropdown / drag / dialog / toast`；若确有新层级，先在令牌表登记并写层级测试页。 | open |
| UIA-010 | P1 | gRPC、WebSocket、SSE、TCP/UDP、消息工作台 | Tab 交互 | 多数 `role="tab"` 只有点击切换，没有 roving `tabIndex`、方向键、Home/End、焦点跟随或完整 panel 关联；HTTP 与协作页已实现，形成行为不一致。 | 运行时聚焦 WebSocket `Message` 后按 `ArrowRight`，选中与焦点仍停留在 Message；隔离统计中 gRPC 7/7、WebSocket 8/8、AMQP 6/6 个可见 Tab 均进入 Tab 顺序。 | 抽取共享 `Tabs`；统一 WAI-ARIA Tabs 模式，补 `id/aria-controls/tabpanel/aria-labelledby` 和键盘测试。 | open |
| UIA-011 | P1 | 弹窗 | 焦点管理 | 项目/集合创建、接口响应新增等弹窗直接渲染，未统一使用现有 `useDialogFocus`；焦点可能逃逸、Escape 行为和关闭后归位不一致。 | 20 个 `role="dialog"`，仅 6 处 `useDialogFocus(...)` 调用；`WorkspaceExplorer.tsx:408-409`、`InterfaceLifecycle.tsx:2201`。 | 抽取 `Modal` 基础组件，默认包含焦点圈定、Escape、初始焦点、返回焦点、滚动锁定和标题/描述关联。 | open |
| UIA-012 | P2 | 新建项目/集合 | 防误操作 | 多个输入弹窗点击遮罩即关闭，未提示未保存内容；用户误点外围会丢失已输入名称或配置。 | `WorkspaceExplorer.tsx:408-409`、`WorkbenchDeck.tsx` 中项目创建弹窗。 | 空草稿可直接关闭；草稿变脏后忽略遮罩点击或弹出放弃确认；Escape 同样遵守该规则。 | open |
| UIA-013 | P1 | 项目侧轨 | 交互闭环 | “自动化”入口只修改 hash 和选中状态，没有对应内容挂载或功能分发。 | 运行时点击后 URL 变为 `view=automation`，侧轨选中“自动化”，主区仍完整显示 WebSocket 工作台；`AppShell.tsx:123-127,351`。 | 功能完成前隐藏或标记 Beta/Coming soon 且不可进入；完成后注册为正式 project view，并补深链恢复与空状态。 | open |
| UIA-014 | P1 | 项目设置 | 交互闭环 | “克隆项目”按钮视觉上可用但没有 `onClick`；属于假操作，损害用户对其他按钮的信任。 | 运行时点击“克隆项目”后 URL、弹窗、通知和项目状态均无变化；`AppShell.tsx:102`。 | 接入真实克隆流程；未实现前禁用并说明原因，或移除入口。 | open |
| UIA-015 | P2 | 项目设置 | 导航逻辑 | “环境与变量”和“项目脚本”共用 `resources` category，两个入口会同时呈现 active，导航层级与内容定位不明确。 | `AppShell.tsx:99`。 | 拆分为 `environment`、`scripts` 两个 category，或合并成单一“项目资源”入口并移除重复选中项。 | open |
| UIA-016 | P1 | 表单、登录、配置 | HTML 语义 | 117 个按钮未显式声明 `type`；按钮一旦处于 `form` 中会默认提交，后续重构容易引入误提交。 | `TeamWorkbench.tsx`、`WebSocketWorkbench.tsx`、`SocketWorkbench.tsx`、`RpcWorkbench.tsx` 等。 | 组件默认输出 `type="button"`；仅确认提交使用 `type="submit"`；ESLint/测试禁止无 type 的原生 button。 | open |
| UIA-017 | P1 | 脚本库、资源与工具页 | 危险操作 | 删除与清空交互不一致；部分路径使用共享确认框，脚本删除等路径立即执行，不支持撤销。 | `ScriptLibraryWorkbench.tsx:12` 直接删除；`WorkspaceExplorer.tsx:187` 使用确认框。 | 危险操作统一策略：可撤销优先 Toast 撤销，不可撤销使用 danger confirm，按钮文案明确对象与结果。 | open |
| UIA-018 | P2 | 登录、AI、协作配置 | 表单效率 | 多个数据录入区用 `div + onClick` 组合而非表单提交语义，回车提交、浏览器密码管理和字段级校验体验不一致。 | `TeamWorkbench.tsx:35-36`、`AiWorkbench.tsx:25`、`SsoWorkbench.tsx:21`。 | 主要录入流程改为 `<form onSubmit>`；提供 autocomplete、校验摘要、字段错误和提交中状态。 | open |
| UIA-019 | P2 | 全局 | 字段标签 | 页面同时存在可见 label、纯 aria-label、placeholder 代替标签和全大写嵌套文本等多套方式；长表单扫描和错误定位不稳定。 | `AmqpWorkbench.tsx:6-7`、`KafkaWorkbench.tsx:6`、`TeamWorkbench.tsx:35-36`、`HttpWorkbench.tsx`。 | 统一 `Field` 结构：label、optional/required、description、control、error；placeholder 仅示例，不承担标签职责。 | open |
| UIA-020 | P1 | 全局 | 错误反馈 | 字段级错误与控件关联仍不完整，部分异步失败仅落到页面底部 message 或空状态；读屏器与视线都难以快速定位原因。 | `docs/UI_UX_DESIGN_SYSTEM.md` 已标记“部分完成”；`AiWorkbench.tsx`、`TeamWorkbench.tsx`、`CaptureWorkbench.tsx` 的统一 message 区。 | 错误靠近字段并用 `aria-invalid + aria-describedby`；跨字段/网络错误用 alert banner；保留可复制技术详情与重试动作。 | open |
| UIA-021 | P2 | 全局 | 加载与反馈 | 不同工作台分别使用按钮文案、badge、页面 message、status footer 或无反馈，成功/进行中/失败的持续时间与位置不一致。 | `ProtocolWorkbenchLayout.tsx`、`WorkbenchFrame.tsx:101` 与多个私有工作台实现。 | 定义操作反馈矩阵：按钮 busy、局部 skeleton、稳定状态栏、Toast、阻塞 Dialog 的适用条件；共享组件统一文案与 ARIA live。 | open |
| UIA-022 | P1 | 实时消息、资源树 | 性能与可用性 | 部分长列表已虚拟化，但 WebSocket 消息列表和完整资源树仍直接 map；长连接或大型项目中会导致卡顿、焦点跳动和滚动恢复困难。 | `WebSocketWorkbench.tsx:204,225`、`WorkspaceExplorer.tsx:331-400`；HTTP/Capture/Team 已使用 `VirtualList`。 | 为实时消息和资源树接入可变层级虚拟列表；保留选中项、键盘位置与滚动锚点；设置合理保留上限。 | open |
| UIA-023 | P1 | 响应式 | 布局 | AMQP/Kafka/Team/AI 等工作台使用内联固定多列布局，媒体查询难覆盖；窄屏出现内容裁切、拥挤和过长纵向滚动。 | 375px 实测 HTTP/SSE 参数行超出容器，WebSocket commandbar、Tabs 和消息编辑器存在 offscreen 子元素；Gateway/AI 退化为很长的单列页面。 | 将布局迁入 class 和容器查询；按内容宽度从 3→2→1 列；移动端保持主操作与错误信息靠近相关字段。 | open |
| UIA-024 | P1 | 全局 | 术语与信息架构 | “项目 / 模块 / 目录 / 集合 / 请求 / 接口”在资源树、项目设置、保存和 Runner 中交替使用，层级关系需要用户自行推断。 | `WorkspaceExplorer.tsx:376-409`、`WorkbenchDeck.tsx:430`、`AppShell.tsx:99-109`。 | 制定术语表：Project → Module（可选）→ Collection → Request/Interface；同一对象全局使用一个主名称，兼容术语放帮助文本。 | open |
| UIA-025 | P2 | HTTP、实时协议 | 操作层级 | 各协议主操作使用 `http-send-button`、`websocket-primary`、`ui-button primary` 和内联按钮等不同实现；发送/连接/发布/订阅的尺寸、busy、取消和快捷键不统一。 | `HttpWorkbench.tsx`、`WebSocketWorkbench.tsx:211`、`SseWorkbench.tsx:70`、`AmqpWorkbench.tsx:6`。 | 抽取 `RunAction` / `ConnectionAction`，统一主次层级、进行中切换、取消位置、快捷键与禁用原因。 | open |
| UIA-026 | P2 | 状态、Badge | 状态表达 | 多处使用全大写英文 badge（`BYOK · EXPLICIT`、`OIDC READY`、`CAPTURING`）与中文正文混排，且状态语气和颜色没有统一词典。 | `AiWorkbench.tsx:25`、`SsoWorkbench.tsx:21`、`CaptureWorkbench.tsx:14`。 | 建立状态词典与 `StatusBadge`：中文 locale 使用中文状态，协议/标准缩写除外；状态同时具备图标、文字和语义色。 | open |
| UIA-027 | P2 | 全局 | 禁用态 | 全局禁用态统一 `opacity: .45`，会同时削弱文字、图标和边框，在浅色主题及小字号下可读性不足，也未向用户解释禁用原因。 | `styles.css:30`。 | 保持禁用文字最低对比度；仅降低背景/边框，不整体透明；关键禁用操作提供邻近说明或可聚焦 tooltip。 | open |
| UIA-028 | P2 | 菜单、更多操作 | 键盘交互 | 多个自定义 `role="menu"` 主要处理点击与开关，缺少统一的方向键移动、Home/End、Escape、焦点返回和 typeahead。 | `WorkspaceExplorer.tsx:155-188,374-388`、`WebSocketWorkbench.tsx:226`、`WorkbenchDeck.tsx` 的标签更多菜单。 | 抽取 `Menu/Popover`；实现完整键盘模型、自动定位、视口碰撞处理与关闭后焦点归位。 | open |
| UIA-029 | P2 | Web 移动端 | 视口与滚动 | 壳层使用 `100vh` 且 body 全局 `overflow: hidden`，移动浏览器地址栏变化和软键盘弹出时可能裁切内容或形成多层滚动陷阱。 | `styles.css:27,34`。 | Web 使用 `100dvh` 并提供 `100vh` fallback；明确每个页面唯一主滚动容器；输入聚焦时验证软键盘与底部操作可见性。 | open |
| UIA-030 | P1 | 设计治理 | 状态可信度 | 现有设计系统和走查文档将若干领域标为完成，但运行时仍可见混合语言、通用 bolt 图标、Tab 键盘失败、主题对比度失败和假入口。 | `docs/UI_UX_DESIGN_SYSTEM.md`、`docs/UX_WALKTHROUGH.md` 对照 UIA-002/003/010/013/014/039。 | “完成”必须绑定验收用例、截图与测试；历史问题保留 done，但新增回归 ID；每次发布更新本表状态和证据。 | open |
| UIA-031 | P2 | 组件库 | 可视化回归 | 缺少独立组件展示与主题矩阵，基础控件只能在复杂工作台中观察，样式改动容易产生跨页回归。 | `packages/ui` 未见 Storybook/组件 playground；现有截图以整页为主。 | 建立轻量 UI gallery：两种主题、中文/英文、常规/hover/focus/disabled/error/loading；接入截图差异测试。 | open |
| UIA-032 | P2 | 测试 | 交互回归 | `web-smoke.spec.ts` 已覆盖工作台边界、主题和部分设置，但缺少逐工作台视觉、国际化、对比度、Tab 键盘和真实功能闭环，因此未阻止本轮发现的回归。 | `e2e` 当前 4 个 spec；UIA-010、013、014、037–046 均未被现有断言覆盖。 | 在现有 smoke 基础上增加 UI matrix：每族覆盖深/浅、中/英、键盘主路径、关键空/错/忙状态和截图差异。 | open |
| UIA-033 | P2 | 空状态 | 引导 | 共享 `EmptyState` 已存在，但多个工作台仍使用私有空白文案或大面积空区域，下一步动作和示例不一致。 | `feedback.css:15`；`CaptureWorkbench.tsx:14`、`TeamWorkbench.tsx`、`WebSocketWorkbench.tsx` 的私有空状态。 | 统一空状态结构：发生了什么、为什么、推荐下一步、可选示例；空状态内主按钮只保留一个。 | open |
| UIA-034 | P2 | 快捷键 | 跨平台 | 顶栏固定展示 `⌘ K`，Windows 用户看到 macOS 符号；部分文案写 `Ctrl/⌘`，展示规则不统一。 | `AppShell.tsx:340`、`i18n.ts` 的 command/settings 文案；Windows 是项目主要桌面环境之一。 | 根据 `navigator.platform`/Tauri OS 展示 Ctrl 或 ⌘；内部用标准 shortcut model，tooltip、菜单和帮助页共用。 | open |
| UIA-035 | P1 | 设置、资源、协作 | 功能发现性 | 设置、项目设置、环境、脚本库、协作、工具工作台分别通过顶栏、侧轨、命令面板与事件入口打开，缺少稳定的“在哪里管理什么”心智模型。 | `AppShell.tsx:99-109,339-352`、`WorkspaceExplorer.tsx:382`、命令面板 actions。 | 明确三级范围：应用设置、项目设置、当前请求设置；同一功能只保留一个主入口，其他入口作为带上下文的快捷方式。 | open |
| UIA-036 | P2 | 文档、设计交付 | 验收清单 | 现有规范描述目标较完整，但没有按页面记录负责人、验收尺寸、主题、键盘路径和截图，难以判断迁移是否真正完成。 | `docs/UI_UX_DESIGN_SYSTEM.md` 以领域状态为主。 | 为每个工作台建立验收矩阵：负责人、状态、桌面/移动、深/浅、中/英、键盘、读屏、空/错/忙状态、截图链接。 | open |
| UIA-037 | P1 | 全局 | 文档语言 | 保存 `en-US` 后页面壳层显示英文，但 `<html lang>` 仍为 `zh-CN`；读屏器会使用错误的发音规则。 | 17 个隔离英文偏好页面均运行时返回 `document.documentElement.lang === "zh-CN"`；`i18n.ts` 只在 `setLocale()` 时更新 lang，初始化未同步。 | 应用启动时立即把解析后的 locale 写入 `document.documentElement.lang`；为首次加载、保存语言和浏览器语言分别补测试。 | open |
| UIA-038 | P1 | 接口生命周期 | 可访问名称 | 生命周期 Tablist 的可访问名称是字面量 Unicode 转义串，读屏器可能读出 `backslash-u-63a5...` 而不是“接口生命周期”。 | Chromium accessibility snapshot 在 HTTP 与 WebSocket 中均显示 `tablist "\\u63a5\\u53e3..."`。 | 将 JSX 字符串修正为真实中文或 i18n 文案；增加基于可访问名称的浏览器断言。 | open |
| UIA-039 | P1 | 浅色主题 | 对比度 | Gateway、Capture、AI 及部分消息/数据工作台的私有表面没有正确适配浅色主题，产生大块深灰卡片、深色文字和近乎不可读的禁用操作。 | 桌面浅色截图；扫描样本：Capture“开始抓包”约 1.06:1、Gateway 操作约 1.12:1、AI 标签约 1.74:1、MQTT/Redis 标签约 1.79–1.80:1。 | 立即迁移私有颜色到语义令牌；正文达到 4.5:1、大字号/图形达到 3:1；禁用态也应保持可辨识，逐页加入对比度回归。 | open |
| UIA-040 | P1 | HTTP、SSE、WebSocket | 移动布局 | 页面整体 `scrollWidth` 没有溢出并不代表内容完整；多个内部容器通过裁切隐藏超宽内容，用户无法看到或操作右侧字段。 | 375px DOM 几何显示 HTTP/SSE 参数表头与值单元格 offscreen；WebSocket name、commandbar、request tabs、message editor 子元素超出视口；对应隔离移动截图。 | 宽参数表使用明确的局部横向滚动和滚动提示；commandbar 在窄屏重排；禁止以 `overflow:hidden` 掩盖交互内容。 | open |
| UIA-041 | P1 | Local Agent 连接 | 错误恢复 | 实际 Agent CORS/网络失败统一显示“Failed to fetch / 连接异常”，用户无法判断是服务未启动、CORS、Token、版本还是地址错误；错误同时出现在资源树与具体工具页。 | 实测控制台出现 `39217/v1/session` 和 `/health` CORS 失败；资源树仅显示 `Failed to fetch`，Capture 页面再次显示同一技术错误。 | Agent 客户端输出结构化错误码；UI 区分未启动、CORS、鉴权、版本和超时，提供“复制诊断”“打开设置”“重试”，避免同一错误重复占据多个区域。 | open |
| UIA-042 | P2 | Capture | 文本排版 | 代理配置标签和代码缺少分隔与收缩规则，渲染为 `CONFIGURE YOUR APPHTTP_PROXY=...`，移动端和桌面端都出现拼接或溢出。 | `isolated-desktop-light-en-capture.png`、`isolated-mobile-light-en-capture.png`。 | 标签与 code 分为块级元素；code 可复制、可换行或自身横向滚动；提供“一键复制代理地址”。 | open |
| UIA-043 | P2 | 移动端壳层 | 信息密度 | 375px 下仍永久保留约 53px 项目侧轨，占用约 14% 宽度，使复杂工作台只有约 322px 可用；文字被迫逐字换行或裁切。 | 所有 `isolated-mobile-light-en-*.png`；侧轨仍显示资源管理、运行集合、Mock、自动化、项目设置和品牌。 | 小屏侧轨折叠为底部导航、抽屉或单一项目菜单；主工作台获得完整视口宽度；仅保留当前任务最相关入口。 | open |
| UIA-044 | P2 | 状态栏、保存上下文 | 内容质量 | 状态栏向用户展示内部 ID，如 `Save to: default-project / default-collection`，既暴露实现细节，也与中文页面混排。 | WebSocket、Gateway、AI 等隔离截图底部均可见原始 ID。 | 显示可读路径“保存到 Audit Project / Users”；ID 仅放在详情或复制诊断中；文案完全走 i18n。 | open |
| UIA-045 | P2 | 移动端顶部栏 | 发现性 | 小屏顶部栏只剩状态图标、搜索图标、`⌘K`、主题、协作和设置，项目名称与当前上下文消失；Windows/移动用户仍看到 Mac 快捷键。 | 375px 全部隔离截图；`isolated-mobile-light-en-http.png`。 | 顶栏保留当前项目/工作台的最小上下文；移动端隐藏快捷键胶囊，改为可理解的搜索/命令入口；平台化展示 Ctrl/⌘。 | open |
| UIA-046 | P2 | Gateway、Capture、AI | 移动任务流 | 管理型工作台直接把桌面卡片纵向堆叠，页面很长，主操作和结果相距多个屏幕；缺少移动端分步、折叠或 sticky action。 | `isolated-mobile-light-en-gateway.png`、`...-capture.png`、`...-ai.png`；Gateway RequestEnvelope、AI 模型与上下文、Capture 列表与详情连续堆叠。 | 移动端使用“配置 / 内容 / 结果”分段导航或 accordion；主操作 sticky；详情使用抽屉；保持错误和结果靠近触发动作。 | open |

## 4. 建议整改顺序

### 阶段 A：交互与可访问性基线

优先处理 UIA-005、007、010、011、013、014、016、017、020、022、023、024、037–041。目标是消除假入口、误操作、键盘断点、焦点逃逸、严重对比度失败和小屏不可用，不先做大规模视觉换肤。

### 阶段 B：共享组件与语言体系

处理 UIA-001、002、003、018、019、021、025、026、028、033、034、035、042–046。按“实时协议 → 消息协议 → 工具 → 协作”迁移，每迁移一族就补齐中英文、空/错/忙状态和键盘用例。

### 阶段 C：视觉精修与设计治理

处理 UIA-004、006、008、009、012、015、027、029、030、031、032、036。完成字号、主题对比度、图标语义、层级、视觉回归和文档状态闭环。

## 5. 每项问题的完成定义

问题不能仅以“代码已改”标记 done，至少应满足：

1. 对应设计与交互规则进入共享组件或规范，而不是只修一个页面；
2. 深色/浅色、中文/英文、桌面 1440px、平板 768px、移动 375px 均完成检查；
3. 键盘可以完成核心流程，焦点可见且顺序合理；
4. loading、empty、error、success、disabled 至少覆盖实际可能出现的状态；
5. 新增或更新最小单元测试，并在页面稳定后补浏览器 smoke；
6. 附验收截图，并更新本表状态、处理说明和回归测试位置。

## 6. 建议的首批任务拆分

| 批次 | 任务 | 关联问题 | 预期产物 |
|---|---|---|---|
| 1 | 建立共享 Tabs、Modal、Menu | UIA-010、011、028、038 | 组件、键盘单测、迁移 gRPC/WebSocket/SSE |
| 2 | 协议图标与工作台映射 | UIA-003、004 | 图标表、统一 `workbenchIcon(id)`、导航截图 |
| 3 | 表单与按钮基线 | UIA-005、016、018、019、020、027、039 | `Button/Field/FormMessage`、语义颜色、ESLint 规则、登录与 AI 迁移 |
| 4 | 术语与 i18n | UIA-002、024、026、034、037、044、045 | 术语表、完整词典、lang 初始化、硬编码检查 |
| 5 | 实时/消息工作台统一 | UIA-001、021、022、023、025、033、040 | WebSocket/SSE/TCP/UDP/MQTT/AMQP/Kafka 统一骨架 |
| 6 | 工具工作台移动重构 | UIA-039、041–043、046 | Gateway/Capture/AI 浅色与移动布局、Agent 诊断流程 |
| 7 | UI 验收矩阵与回归 | UIA-006、008、009、029-032、036 | UI gallery、E2E matrix、逐页截图与状态更新 |
