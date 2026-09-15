# Mock 服务

ApiVoy 的 Mock 数据面由独立的 `apivoy-mock` 进程提供。它与 Local Agent 使用同一仓库和配置目录，但拥有独立端口；一个进程同时承载所有项目和服务，不会为每个项目启动后端。

## 生命周期与安全

- 服务默认停止，只能由用户显式启动。
- 默认监听 `127.0.0.1:39218`。非回环地址必须在界面确认风险，并由 Agent 校验 `allowRemote`。
- 停止服务会终止进程、释放端口并关闭已有 WebSocket 连接。
- Local Agent 的规则管理和服务启停接口继续要求协议版本与 Agent 鉴权；Mock 数据面不携带 Agent 凭据。

## 请求地址

- 路径模式：`/m1/{projectKey}/{serviceKey}/{path}`
- ID 模式：`/m2/{projectKey}/{serviceKey}/{mockOperationId}`
- 可选选择参数：`apivoyApiId`、`apivoyResponseId`、`apivoyScenarioId`

旧的 `/mock` 和 `/mock-ws` 地址不再兼容。路径模式若同时对应多个接口会返回 `409 Conflict`，调用方应改用 ID 模式或传入 `apivoyApiId`。

## 响应与场景

接口定义保存成功即成为 Mock 生效边界，不引入版本或发布状态。设计阶段的新响应先使用 `client:*` 临时键；保存时由后端从 `100000000` 开始通过数据库全局自增序列分配纯数字响应 ID，并同步字段引用。接口与定义首次绑定时，后端通过同一序列分配纯数字 `mockOperationId`。ID 超过九位后自然增长为十位，删除后不复用。保存的响应示例优先作为返回正文，未提供示例时根据响应 Schema 生成确定性数据。

自定义场景只用于条件匹配、延迟、周期故障和 WebSocket 行为等覆盖。每条场景有独立 `enabled` 开关；新建默认启用，旧规则缺少该字段时也按启用读取。停用会保留配置但不参与匹配，“设为当前”只调整同一接口内场景优先级，不能替代启停。

匹配边界为 `projectKey + serviceKey + method + path/operationId`，不会跨项目或服务回退。条件可包含 Query、Header、Cookie 和 Body 包含文本。
