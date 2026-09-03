import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@apivoy/ui/styles.css";
import {
  Accordion, Breadcrumbs, Button, ButtonGroup, Checkbox, DataTable, Dialog, Drawer,
  DropdownMenu, EmptyState, Field, IconButton, InlineAlert, LoadingState, Pagination,
  ProgressBar, Radio, SearchInput, SegmentedControl, Select, Skeleton, StatusBadge,
  Switch, Tabs, Tag, Textarea, TextInput, Toolbar,
} from "@apivoy/ui/components";
import "./component-showcase.css";

type RequestTab = "params" | "body" | "headers" | "auth";
type Scope = "all" | "project" | "team";

function Showcase() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [tab, setTab] = useState<RequestTab>("params");
  const [scope, setScope] = useState<Scope>("all");
  const [enabled, setEnabled] = useState(true);
  const [search, setSearch] = useState("users");
  const [page, setPage] = useState(2);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  function switchTheme() { const next = theme === "dark" ? "light" : "dark"; setTheme(next); document.documentElement.dataset.theme = next; }

  const requestRows = [
    { method: <Tag tone="success">GET</Tag>, name: "查询用户列表", target: <code>/v1/users</code>, status: <StatusBadge tone="success">200</StatusBadge>, duration: "128 ms", action: <IconButton label="更多操作" icon="more" /> },
    { method: <Tag tone="info">POST</Tag>, name: "创建用户", target: <code>/v1/users</code>, status: <StatusBadge tone="danger">500</StatusBadge>, duration: "842 ms", action: <IconButton label="更多操作" icon="more" /> },
    { method: <Tag tone="warning">PATCH</Tag>, name: "更新用户", target: <code>/v1/users/:id</code>, status: <StatusBadge>未运行</StatusBadge>, duration: "—", action: <IconButton label="更多操作" icon="more" /> },
  ];
  const requestTabs = [
    { value: "params" as const, label: "Params 2", content: <ParameterEditor /> },
    { value: "body" as const, label: "Body", content: <div className="code-surface"><code>{'{\n  "name": "Ada",\n  "role": "developer"\n}'}</code></div> },
    { value: "headers" as const, label: "Headers 3", content: <ParameterEditor headers /> },
    { value: "auth" as const, label: "Auth", content: <div className="showcase-form-row"><Field label="鉴权类型"><Select defaultValue="bearer"><option value="none">No Auth</option><option value="bearer">Bearer Token</option></Select></Field><Field label="Token" hint="支持环境变量"><TextInput type="password" defaultValue="secret-token" /></Field></div> },
  ];

  return <div className="component-showcase">
    <aside><strong>ApiVoy UI</strong><span>项目组件目录 · 完整版</span><nav aria-label="组件目录"><a href="#foundation">基础规范</a><a href="#buttons">按钮</a><a href="#forms">表单</a><a href="#navigation">导航</a><a href="#data">数据展示</a><a href="#feedback">状态反馈</a><a href="#overlays">浮层</a><a href="#patterns">项目模式</a></nav></aside>
    <main>
      <header><div><h1>公共组件库</h1><p>基于项目真实 React 组件、Token 与业务模式生成；这里只调整样式源，不改变产品页面布局。</p></div><IconButton label="切换明暗主题" icon={theme === "dark" ? "sun" : "moon"} onClick={switchTheme} /></header>
      <section id="foundation"><SectionTitle title="基础规范" description="颜色、控件尺寸、圆角、字体和层级均来自项目 --apivoy-* Token。"/><div className="token-grid">{[["背景", "var(--apivoy-bg)"], ["工作区", "var(--apivoy-workspace)"], ["浮层", "var(--apivoy-bg-elevated)"], ["边框", "var(--apivoy-border)"], ["主色", "var(--apivoy-accent)"], ["成功", "var(--apivoy-success)"], ["警告", "var(--apivoy-warning)"], ["危险", "var(--apivoy-danger)"]].map(([name, color]) => <div className="token" key={name}><i style={{ background: color }} /><span>{name}</span><code>{color}</code></div>)}</div><div className="foundation-meta"><span>控件高度 <b>34px</b></span><span>控件圆角 <b>6px</b></span><span>正文 <b>13px</b></span><span>代码 <b>Mono</b></span></div></section>
      <section id="buttons"><SectionTitle title="按钮与操作" description="包含层级、尺寸、图标、加载、禁用、组合按钮和菜单状态。"/><Example label="按钮层级"><Button variant="primary">主要操作</Button><Button>次要操作</Button><Button variant="danger">危险操作</Button><Button variant="ghost">弱操作</Button></Example><Example label="尺寸与状态"><Button size="compact">紧凑按钮</Button><Button variant="primary" icon="plus">带图标</Button><Button icon="download" iconPosition="end">尾部图标</Button><Button variant="primary" loading>处理中</Button><Button disabled>禁用</Button></Example><Example label="图标按钮"><IconButton label="搜索" icon="search" /><IconButton label="设置" icon="settings" active /><IconButton label="删除" icon="trash" tone="danger" /><IconButton label="关闭" icon="close" /></Example><Example label="组合与更多操作"><ButtonGroup aria-label="保存操作"><Button variant="primary" icon="archive">保存</Button><Button variant="primary" icon="chevron" aria-label="更多保存选项" /></ButtonGroup><DropdownMenu label="项目操作" items={[{ id: "rename", label: "修改名称", icon: "edit" }, { id: "copy", label: "克隆项目", icon: "copy" }, { id: "delete", label: "删除项目", icon: "trash", danger: true }]} /></Example></section>
      <section id="forms"><SectionTitle title="表单控件" description="覆盖常规、搜索、密码、数字、只读、禁用、错误、文件和选择类控件。"/><div className="form-grid"><Field label="参数名" required hint="常规输入"><TextInput defaultValue="pageSize" /></Field><Field label="搜索接口"><SearchInput aria-label="搜索接口" value={search} onChange={(event) => setSearch(event.target.value)} onClear={() => setSearch("")} /></Field><Field label="参数类型"><Select defaultValue="string"><option>string</option><option>number</option><option>boolean</option><option>file</option></Select></Field><Field label="超时时间"><TextInput type="number" defaultValue="30000" min={1} /></Field><Field label="访问令牌"><TextInput type="password" defaultValue="token-value" /></Field><Field label="只读值"><TextInput value="由环境变量提供" readOnly /></Field><Field label="校验错误" error="请输入合法 URL"><TextInput defaultValue="invalid-url" /></Field><Field label="禁用字段"><TextInput value="不可编辑" disabled readOnly /></Field><Field label="请求说明" className="span-2"><Textarea defaultValue="分页查询用户列表" rows={3} /></Field><Field label="二进制文件" hint="项目中的文件选择场景"><TextInput type="file" /></Field></div><Example label="选择控件"><Checkbox label="启用参数" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><Checkbox label="禁用选项" disabled /><Radio label="自动" name="mode" defaultChecked /><Radio label="手动" name="mode" /><Switch label="自动保存" defaultChecked /><Switch label="只读开关" disabled /></Example><Example label="标签"><Tag>Default</Tag><Tag tone="info">HTTP</Tag><Tag tone="success">Connected</Tag><Tag tone="warning">Unsaved</Tag><Tag tone="danger">Failed</Tag><Tag removable onRemove={() => undefined}>可移除</Tag></Example></section>
      <section id="navigation"><SectionTitle title="导航与信息架构" description="面包屑、分段选择、页签、工具栏和分页。"/><Example label="面包屑"><Breadcrumbs items={[{ label: "工作区", onClick: () => undefined }, { label: "用户中心", onClick: () => undefined }, { label: "查询用户", current: true }]} /></Example><Example label="分段选择"><SegmentedControl ariaLabel="资源范围" value={scope} onValueChange={setScope} items={[{ value: "all", label: "全部" }, { value: "project", label: "当前项目" }, { value: "team", label: "团队" }]} /></Example><Example label="命令工具栏"><Toolbar label="请求历史操作"><SearchInput aria-label="筛选请求历史" placeholder="搜索请求" /><Select aria-label="协议筛选" defaultValue="all"><option value="all">全部协议</option><option>HTTP</option><option>WebSocket</option></Select><span className="ui-toolbar-spacer"/><Button size="compact" icon="download">导出</Button><IconButton label="刷新" icon="activity" /></Toolbar></Example><Example label="分页"><Pagination page={page} pages={8} onPageChange={setPage}/></Example></section>
      <section id="data"><SectionTitle title="数据展示" description="状态、表格、折叠内容和代码型数据。"/><Example label="状态徽标"><StatusBadge>未运行</StatusBadge><StatusBadge tone="info">运行中</StatusBadge><StatusBadge tone="success">成功</StatusBadge><StatusBadge tone="warning">警告</StatusBadge><StatusBadge tone="danger">失败</StatusBadge></Example><DataTable caption="请求执行历史" columns={[{ id: "method", label: "方法" }, { id: "name", label: "请求名称" }, { id: "target", label: "目标" }, { id: "status", label: "状态" }, { id: "duration", label: "耗时", align: "end" }, { id: "action", label: "", align: "end" }]} rows={requestRows}/><div className="showcase-two-columns"><Accordion items={[{ id: "request", title: "实时请求", content: "展示最终 URL、Header、Body 和生成的请求代码。", defaultOpen: true }, { id: "timing", title: "请求耗时", content: "DNS、连接、TLS、发送和接收阶段。" }, { id: "assertions", title: "响应校验", content: "状态码、Header 和响应体断言。" }]}/><div className="code-surface"><code>Authorization: Bearer {'{{token}}'}<br/>Content-Type: application/json<br/>X-Request-ID: 58ac2</code></div></div></section>
      <section id="feedback"><SectionTitle title="状态与反馈" description="提示、进度、加载、骨架屏和空状态。"/><div className="alert-grid"><InlineAlert title="提示">修改公共 Token 会同步影响所有接入页面。</InlineAlert><InlineAlert tone="success" title="请求成功">响应状态 200，耗时 128 ms。</InlineAlert><InlineAlert tone="warning" title="需要注意">当前环境存在未保存变量。</InlineAlert><InlineAlert tone="danger" title="请求失败">无法连接本地代理。</InlineAlert></div><div className="feedback-grid"><ProgressBar value={68} label="集合运行进度"/><LoadingState label="正在加载请求历史…"/><Skeleton lines={4}/><EmptyState title="暂无请求历史" description="发送请求后，执行记录会显示在这里。" action={<Button size="compact" icon="send">发送请求</Button>}/></div></section>
      <section id="overlays"><SectionTitle title="浮层与临时界面" description="下拉菜单、模态对话框和右侧抽屉均可直接交互。"/><Example label="打开示例"><Button onClick={() => setDialogOpen(true)}>打开确认弹窗</Button><Button onClick={() => setDrawerOpen(true)}>打开详情抽屉</Button><DropdownMenu label="更多浮层操作" items={[{ id: "edit", label: "编辑", icon: "edit" }, { id: "copy", label: "复制", icon: "copy" }, { id: "remove", label: "删除", icon: "trash", danger: true }]} /></Example></section>
      <section id="patterns"><SectionTitle title="项目专用组合模式" description="来自 ApiVoy 真实页面的 HTTP 命令栏、参数编辑器、请求历史和资源树结构。"/><article className="pattern-card"><h3>HTTP 请求命令栏</h3><div className="http-pattern-command"><Select aria-label="HTTP 方法" defaultValue="GET"><option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option></Select><TextInput aria-label="目标 URL" defaultValue="https://api.example.com/v1/users"/><Button variant="primary" icon="send">发送</Button><ButtonGroup><Button icon="archive">保存</Button><Button icon="chevron" aria-label="保存选项" /></ButtonGroup></div><Tabs ariaLabel="HTTP 请求编辑区" value={tab} onValueChange={setTab} items={requestTabs}/></article><div className="pattern-grid"><article className="pattern-card"><h3>请求历史</h3><div className="history-pattern"><div><StatusBadge tone="success">200</StatusBadge><strong>GET /v1/users</strong><small>今天 14:32 · 128 ms</small></div><div><StatusBadge tone="danger">500</StatusBadge><strong>POST /v1/users</strong><small>今天 14:28 · 842 ms</small></div><div><StatusBadge tone="success">204</StatusBadge><strong>DELETE /v1/users/42</strong><small>昨天 18:06 · 96 ms</small></div></div></article><article className="pattern-card"><h3>工作区资源树</h3><div className="tree-pattern" role="tree" aria-label="资源树示例"><button role="treeitem" aria-expanded="true">用户中心</button><button role="treeitem" className="level-2">用户管理</button><button role="treeitem" className="level-3 is-active">GET 查询用户列表</button><button role="treeitem" className="level-3">POST 创建用户</button><button role="treeitem">订单中心</button></div></article></div></section>
    </main>
    <Dialog open={dialogOpen} title="保存接口" description="保存后将更新当前项目中的接口定义。" onClose={() => setDialogOpen(false)} footer={<><Button onClick={() => setDialogOpen(false)}>取消</Button><Button variant="primary" onClick={() => setDialogOpen(false)}>确认保存</Button></>}><div className="showcase-form-stack"><Field label="接口名称" required><TextInput defaultValue="查询用户列表" /></Field><Field label="保存目录"><Select defaultValue="users"><option value="users">用户中心 / 用户管理</option><option value="root">项目根目录</option></Select></Field></div></Dialog>
    <Drawer open={drawerOpen} title="请求详情" description="GET /v1/users · 200 OK" onClose={() => setDrawerOpen(false)} footer={<Button variant="primary" onClick={() => setDrawerOpen(false)}>完成</Button>}><div className="showcase-form-stack"><ProgressBar value={100} label="响应接收"/><DataTable caption="响应摘要" columns={[{ id: "name", label: "指标" }, { id: "value", label: "值", align: "end" }]} rows={[{ name: "状态码", value: "200 OK" }, { name: "耗时", value: "128 ms" }, { name: "响应大小", value: "2.4 KB" }]}/><InlineAlert tone="success" title="校验通过">3 条响应断言全部通过。</InlineAlert></div></Drawer>
  </div>;
}

function SectionTitle({ title, description }: { title: string; description: string }) { return <header className="section-title"><h2>{title}</h2><p>{description}</p></header>; }
function Example({ label, children }: { label: string; children: ReactNode }) { return <div className="showcase-example"><span>{label}</span><div className="component-row">{children}</div></div>; }
function ParameterEditor({ headers = false }: { headers?: boolean }) {
  const rows = headers
    ? [["Content-Type", "application/json", "String", "响应内容类型"], ["X-Request-ID", "{{requestId}}", "String", "链路标识"]]
    : [["page", "1", "String", "页码"], ["pageSize", "20", "Number", "每页数量"]];
  return <div className="http-kv-editor showcase-http-kv" aria-label={headers ? "请求 Headers" : "URL Query Params"}>
    <div className="http-param-header"><span/><span>参数名</span><span>参数值</span><span className="http-type-header"><span>类型</span><button type="button" aria-label="切换全部参数是否必填">*</button></span><span/><span>说明</span><span/></div>
    {rows.map((row, index) => <div className="http-param-row http-apifox-row has-content is-entry is-enabled" key={row[0]}>
      <input className="http-row-enabled" type="checkbox" aria-label={`停用参数 ${index + 1}`} defaultChecked/>
      <div className="http-param-name-cell"><input className="showcase-http-control" aria-label={`参数 ${index + 1} 名称`} defaultValue={row[0]}/></div>
      <div className="http-param-value-cell"><input className="showcase-http-control" aria-label={`参数 ${index + 1} 值`} defaultValue={row[1]}/></div>
      <div className="http-param-type-cell"><select className="http-param-type showcase-http-control" aria-label={`参数 ${index + 1} 类型`} defaultValue={row[2]}><option>String</option><option>Number</option><option>Boolean</option></select></div>
      <span className="http-required-row"><button type="button" aria-pressed="false" aria-label={`参数 ${index + 1} 设为必填`}>*</button></span>
      <input className="showcase-http-control" aria-label={`参数 ${index + 1} 说明`} defaultValue={row[3]}/>
      <IconButton className="http-kv-delete" label={`删除参数 ${index + 1}`} icon="trash"/>
    </div>)}
    <div className="http-param-row http-apifox-row is-new">
      <input className="http-row-enabled" type="checkbox" aria-label="启用新参数"/>
      <div className="http-param-name-cell"><input className="showcase-http-control" aria-label="新参数名称" placeholder="添加参数"/></div>
      <div className="http-param-value-cell"><input className="showcase-http-control" aria-label="新参数值"/></div>
      <div className="http-param-type-cell"><select className="http-param-type showcase-http-control" aria-label="新参数类型" defaultValue="String"><option>String</option><option>Number</option><option>Boolean</option></select></div>
      <span className="http-required-row"><button type="button" aria-pressed="false" aria-label="新参数设为必填">*</button></span>
      <input className="showcase-http-control" aria-label="新参数说明"/>
      <span className="http-kv-delete-placeholder" aria-hidden="true"/>
    </div>
  </div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Showcase /></StrictMode>);
