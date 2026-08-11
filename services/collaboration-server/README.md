# ApiVoy Collaboration Server

ApiVoy 的 Java 21 / Spring Boot 3 可部署协作服务，支持本地 H2 与 PostgreSQL 私有化部署。

当前能力：

- 首位 Owner 安全引导、邮箱密码登录、30 天设备会话与注销
- `OWNER / ADMIN / EDITOR / RUNNER / VIEWER` 五级 RBAC
- 工作区快照、单调 revision、增量 change feed 与 `409 revision_conflict`
- 工作区评论主题、回复、编辑、解决/重新打开状态
- Bearer 鉴权的组织 SSE 事件：`workspace.changed` 与 `comment.changed`
- 成员、同步和评论操作审计
- Secret 内容不进入同步 API，仅保留安全引用

## 本地运行

```powershell
$env:APIVOY_COLLAB_BOOTSTRAP_TOKEN="replace-with-a-long-random-token"
.\gradlew.bat clean test bootRun
```

服务默认监听 `http://localhost:8088`，健康检查地址为 `/actuator/health`。第一次启动后调用 `POST /v1/auth/bootstrap`，并通过 `X-ApiVoy-Bootstrap-Token` Header 提供引导令牌。成功创建首位 Owner 后，引导接口会永久拒绝再次使用。

## 私有化部署

```powershell
$env:APIVOY_COLLAB_DATABASE_PASSWORD="replace-me"
$env:APIVOY_COLLAB_BOOTSTRAP_TOKEN="replace-with-a-long-random-token"
docker compose up --build
```

生产环境必须覆盖上述密码变量，持久化数据位于 `apivoy-postgres` volume。

## 同步契约

客户端先读取当前 `revision`，再将无 Secret 完整快照和增量 patch 发送至 `PUT /v1/organizations/{organizationId}/workspaces/{workspaceId}`。`baseRevision` 不匹配时返回 `409`，响应携带 `currentRevision` 和 `currentDocument`，客户端合并后重试。

## 评论契约

组织成员通过 `/v1/organizations/{organizationId}/workspaces/{workspaceId}/comments` 查询或创建主题与回复。作者可编辑自己的评论，管理员可代为维护，`EDITOR` 及以上角色可解决或重新打开主题。所有变更写入审计，并作为 `comment.changed` 推送到组织 SSE 流。

`GET /v1/organizations/{organizationId}/events` 提供 Bearer 鉴权的 SSE 流。跨域来源默认仅允许本地 Web 与 Tauri，可通过 `APIVOY_COLLAB_ALLOWED_ORIGINS` 配置。
