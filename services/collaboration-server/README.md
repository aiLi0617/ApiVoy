# ApiVoy Collaboration Server

P2 团队协作服务的可部署单体基线，使用 Java 21、Spring Boot 3.5 和 Gradle Wrapper。

当前提供：

- 首位 Owner 安全引导、邮箱密码登录、30 天设备会话与注销；
- 组织成员和 `OWNER / ADMIN / EDITOR / RUNNER / VIEWER` 五级 RBAC；
- 工作区快照、单调 revision、增量 change feed 与 `409 revision_conflict` 冲突响应；
- 高风险成员操作和同步写入的不可变审计记录；
- H2 本地运行及 PostgreSQL 私有化部署配置；Secret 内容不进入同步 API。

## 本地运行

```powershell
$env:APIVOY_COLLAB_BOOTSTRAP_TOKEN="replace-with-a-long-random-token"
.\gradlew.bat clean test bootRun
```

服务默认监听 `http://localhost:8088`，健康检查为 `/actuator/health`。第一次启动后调用 `POST /v1/auth/bootstrap`，Header 中提供 `X-ApiVoy-Bootstrap-Token`。成功创建首位 Owner 后，引导接口会永久拒绝再次使用。

## 私有化部署

```powershell
$env:APIVOY_COLLAB_DATABASE_PASSWORD="replace-me"
$env:APIVOY_COLLAB_BOOTSTRAP_TOKEN="replace-with-a-long-random-token"
docker compose up --build
```

生产环境必须覆盖两个密码变量。持久数据位于 `apivoy-postgres` volume。

## 同步契约

客户端先读取工作区当前 `revision`，再将完整无 Secret 快照和增量 patch 发送至 `PUT /v1/organizations/{organizationId}/workspaces/{workspaceId}`。`baseRevision` 不等于服务端 revision 时返回 `409`，响应携带 `currentRevision` 和 `currentDocument`，由客户端执行人工或自动合并后重试。
