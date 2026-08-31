# PR / 变更前置审查清单

> 目的：把曾在 CI / CodeQL / Installer 才爆出的问题，前移到本地与人工/Agent 审查。  
> 用法：开 PR 前自查；维护者与 Codex 审查时按触及面勾选。  
> 关联：[ISSUES.md](../ISSUES.md)（ISS-019…）、[DEPENDENCY_SECURITY.md](../DEPENDENCY_SECURITY.md)、[AGENTS.md](../../AGENTS.md)

状态约定：审查时只勾选**本次改动实际触及**的段落；未触及可标 N/A。

---

## 0. PR / 最终交付前必跑验证（按改动类型）

以下全量验证在 PR 或任务最终交付前集中运行一次，不要求在每次代码编辑后重复执行。
开发过程中优先运行受影响包、模块或用例的最小相关检查；相关修改稳定后再执行全量验证。
纯文档改动无需运行代码测试。若全量验证通过后仅修改了不影响代码的内容，无需重跑。

| 改动 | PR / 最终交付前至少跑一次 |
|------|------------|
| TypeScript / UI | `pnpm typecheck`、`pnpm test`；UI 再加 `pnpm test:e2e` + 截图 |
| Rust / Cargo.lock | `cargo test --workspace --locked`、`cargo clippy --workspace --all-targets --locked -- -D warnings`、`cargo audit -D warnings` |
| 工作流 YAML | 对照下方「流水线断言」；必要时 `workflow_dispatch` 全量 |
| Local Agent / 安装冒烟 | `/health` 断言必须匹配真实 `service` 字段（见 §3） |

---

## 1. 依赖与 cargo audit（曾漏：`RUSTSEC-2026-0258` / `h2`）

触及 `Cargo.toml` / `Cargo.lock` / Rust HTTP 栈时：

- [ ] 本地已跑 `cargo audit -D warnings`（不要只等 CI `security` job）
- [ ] 新 advisory **默认不得**塞进 `.cargo/audit.toml`；若必须忽略，同步更新 [DEPENDENCY_SECURITY.md](../DEPENDENCY_SECURITY.md) 与 ISSUES
- [ ] 传递依赖（如 `reqwest` → `hyper` → `h2`）升级用 `cargo update -p <crate>`，确认 lockfile 写入 PR
- [ ] 不把「仅桌面 GTK 例外」当成可忽略一切 RustSec 的理由

**前置信号**：CI 聚合 job `CI` 会因 `security` 失败而红；`h2 < 0.4.16` 这类问题改 lockfile 即可修，不必改业务代码。

---

## 2. CodeQL / 前端与导入安全（曾漏：XSS、双重解码、ReDoS、原型污染）

触及 `packages/ui`、`packages/import-export`、解析/路径写入、错误展示、XML/HTML 时：

### 2.1 DOM / XSS

- [ ] **不要**用 `DOMParser.parseFromString(userInput, …)` 做校验或渲染准备；即使用 `application/xml` 也会被 CodeQL 判为 client XSS sink
- [ ] 用户/导入内容进入 DOM 前有转义或非 HTML sink；预览 HTML 需隔离（见威胁模型）

### 2.2 HTML 实体解码

- [ ] 展示用解码必须**单次**匹配替换（例如一次匹配 `#x…` / `#…` / `nbsp|amp|lt|gt|quot`）
- [ ] 禁止先 `&amp;`→`&` 再解 `&lt;`，避免 `&amp;lt;` 被解成 `<`（CodeQL `js/double-escaping`）

### 2.3 正则与导入

- [ ] 对 OpenAPI / 模板字符串的 `{var}` → `{{var}}` 等转换优先用**非正则**扫描，避免 `js/polynomial-redos`
- [ ] 导入文本已有体积/深度预算时仍避免把无界用户串直接喂给已知敏感正则

### 2.4 对象路径写入

- [ ] 任意 `setAtPath` / 递归赋值拒绝 `__proto__`、`prototype`、`constructor`
- [ ] 中间对象优先 `Object.create(null)`，避免污染 `Object.prototype`
- [ ] 有回归测试：恶意键名不能落到原型上

**前置信号**：GitHub `CodeQL` 检查可能在 Analyze job 全绿后仍因「new alerts」失败；合并前看 PR Checks 里 CodeQL 注释，不要只看 Analyze 勾号。

---

## 3. 流水线断言与契约（曾漏：Installer `tools` health）

触及 Local Agent、`installer-lifecycle.yml`、release/sidecar 冒烟时：

- [ ] `/health` JSON 的 `service` 实际值是 **`apivoy-agent`**（crate 名是 `apivoy-local-agent`，二进制是 `apivoy-agent`——三者勿混用）
- [ ] 工作流里 `grep` / PowerShell `-eq` 与产品契约一致；改 health 字段时同步改：
  - `.github/workflows/installer-lifecycle.yml`（Unix + Windows tools job）
  - [SMOKE_CHECKLIST.md](../SMOKE_CHECKLIST.md)
  - 任何 release 冒烟脚本
- [ ] 冒烟先等端口就绪，再断言字段；断言失败应打印实际 body，避免只见 `exit 1`

**前置信号**：`Installer lifecycle` 的 `tools (*)` 在编译成功后仍可能红——优先查 health 字符串，而不是编译日志。

---

## 4. 工作流路径与合并后流水线

触及 `.github/workflows/**` 时：

- [ ] `paths` 覆盖真实构建输入（`crates/**`、`Cargo.*`、`packages/**` 等，见 ISS-016）
- [ ] 合并进 `main` 会触发的检查与 PR 检查不同：确认 `push`/`pull_request` 触发器都覆盖到
- [ ] 连续 push 可能取消上一次 run；看**最新 SHA** 的结论，不要拿被 cancel 的 run 当失败根因

---

## 5. 安全敏感面（总闸）

触及 secrets、Agent 鉴权、TLS、脚本、插件、代理、协议解析时：

- [ ] 未削弱 Local Agent 鉴权；默认不远程绑定
- [ ] 日志无未脱敏 Authorization
- [ ] 导入/插件包按不可信输入处理
- [ ] PR 描述「Security impact」已填写；需要时走安全复审（AGENTS.md）

---

## 6. 审查产出建议

审查意见里优先写：

1. **可前置的检查项**（对应本清单章节号）
2. **失败时应对的流水线 job 名**（如 `security`、`tools (ubuntu-24.04)`、`CodeQL`）
3. **最小复现命令**（如 `cargo audit -D warnings`、对 `/health` 的 `curl`）

将新的「只在 CI 才发现」的问题追加到本文件对应章节，并在 [ISSUES.md](../ISSUES.md) 建单或更新状态。
