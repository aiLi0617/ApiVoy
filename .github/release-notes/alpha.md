ApiVoy 首个公开发布：本地优先的多协议接口调试客户端。Windows、macOS、Linux 桌面端，以及 CLI 与 Local Agent。

ApiVoy’s first public release: a local-first, multi-protocol API debugging client for desktop, CLI, and Local Agent.

## 亮点 / Highlights

- **统一工作台** — 在同一客户端调试 HTTP、GraphQL、gRPC、WebSocket、SSE，以及 TCP/UDP、MQTT、AMQP、Kafka、Redis、SQL
- **本地优先** — 工作区保存在本机 SQLite，密钥走系统钥匙串，无需账号
- **桌面端** — Windows MSI、macOS DMG、Linux DEB
- **CLI 与 Local Agent** — 同一套 Rust 协议驱动，可用于脚本与本机执行
- **导入** — 支持 cURL、OpenAPI、HAR、Postman
- **环境与历史** — 环境变量、断言、请求历史、集合运行

- **Unified workspace** for HTTP APIs and infrastructure protocols
- **Local-first** storage and OS keychain secrets; no account required
- Desktop apps, CLI, and Local Agent share the same core
- Import from cURL, OpenAPI, HAR, and Postman
- Environments, assertions, request history, and collection runner

## 下载 / Downloads

请按操作系统选择安装包，并用本页的 `SHA256SUMS.txt` 校验：

- Windows：`.msi`
- macOS：`.dmg`
- Linux：`.deb`
- 各平台 **ApiVoy CLI** 与 **ApiVoy Local Agent** 压缩包
- `SHA256SUMS.txt`

Choose the installer for your OS and verify with `SHA256SUMS.txt` on this release.

```bash
sha256sum -c SHA256SUMS.txt
```

安装后可用 HTTP 工作台访问 `https://httpbin.org/get` 做一次冒烟测试。

## 已知限制 / Known limitations

这是第一个公开发布，部分能力仍在验证中：

- gRPC、AMQP、Kafka 工作台为 **Experimental**
- MQTT / Redis / SQL 的代码生成尚未完成
- 细粒度国际化不完整
- 桌面端 CSP 为基线配置；HTML 响应沙箱仍在规划
- 尚不支持自动更新
- Windows MSI 的 ProductVersion 为 `0.1.0`（WiX 仅接受数字版本）

This is an early public release. Some protocol workbenches remain experimental, fine-grained i18n is incomplete, desktop CSP is baseline, HTML response sandboxing is still planned, and automatic updates are not yet available.

## 安全 / Security

请勿通过公开 GitHub Issues 报告安全漏洞。见 [SECURITY.md](https://github.com/aiLi0617/ApiVoy/blob/main/SECURITY.md)。

Do not report security vulnerabilities through public GitHub Issues. See [SECURITY.md](https://github.com/aiLi0617/ApiVoy/blob/main/SECURITY.md).
