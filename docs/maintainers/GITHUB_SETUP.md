# GitHub repository setup

Run these commands after pushing the OSS readiness changes to `main`.
Requires [GitHub CLI](https://cli.github.com/) authenticated as a repository admin.

## Repository metadata

Set topics and homepage (use the GitHub repo URL until a project site is live):

```bash
gh repo edit aiLi0617/ApiVoy \
  --homepage "https://github.com/aiLi0617/ApiVoy" \
  --add-topic api-client --add-topic api-testing --add-topic developer-tools \
  --add-topic http-client --add-topic grpc --add-topic graphql --add-topic websocket \
  --add-topic mqtt --add-topic kafka --add-topic rust --add-topic tauri \
  --add-topic local-first --add-topic open-source
```

## Security settings (GitHub UI)

Enable these under **Settings → Code security and analysis** and **Settings → Security**:

- Dependabot alerts
- Dependabot security updates
- Secret scanning
- Push protection
- Private vulnerability reporting (**Settings → Security → Private vulnerability reporting → Enable**)

Do **not** use the `vulnerability-alerts` API as a substitute for Private Vulnerability Reporting — that endpoint enables dependency alerts only.

Before linking [SECURITY.md](../../SECURITY.md) publicly, confirm the Private Vulnerability Reporting form loads at:

https://github.com/aiLi0617/ApiVoy/security/advisories/new

## Discussions

```bash
gh api --method PUT repos/aiLi0617/ApiVoy -f has_discussions=true
```

Create categories (run once after Discussions is enabled):

```bash
gh api --method POST repos/aiLi0617/ApiVoy/discussions/categories \
  -f name="Announcements" -f emoji=":mega:" -f description="Release and maintenance updates"

gh api --method POST repos/aiLi0617/ApiVoy/discussions/categories \
  -f name="Ideas" -f emoji=":bulb:" -f description="Feature ideas and product feedback"

gh api --method POST repos/aiLi0617/ApiVoy/discussions/categories \
  -f name="Q&A" -f emoji=":question:" -f description="Help and usage questions"

gh api --method POST repos/aiLi0617/ApiVoy/discussions/categories \
  -f name="Show and tell" -f emoji=":sparkles:" -f description="Share workflows and integrations"

gh api --method POST repos/aiLi0617/ApiVoy/discussions/categories \
  -f name="Protocol compatibility" -f emoji=":satellite:" -f description="Broker and server compatibility reports"
```

## Clean up early test releases

Historical tags `V1.0.0` and `V1.0.1` used inconsistent versioning and should **not** appear as stable releases.

Recommended:

1. Mark each release as **Pre-release** in the GitHub UI, or delete the release if it was internal testing only.
2. Edit the release description to note they were internal preview builds superseded by `v0.1.0-alpha.1`.
3. Do not create new tags using the `V*` prefix — release tags must use lowercase `v*` (for example `v0.1.0-alpha.1`).

## Milestones

```bash
gh api repos/aiLi0617/ApiVoy/milestones -f title="v0.1 Public Alpha" -f description="First public alpha release and installers"
gh api repos/aiLi0617/ApiVoy/milestones -f title="v0.2 Protocol Stability" -f description="gRPC/MQ broker tests and compatibility matrix"
gh api repos/aiLi0617/ApiVoy/milestones -f title="v0.3 Plugin Ecosystem" -f description="Example WASM plugins and publisher docs"
gh api repos/aiLi0617/ApiVoy/milestones -f title="v1.0 Stable" -f description="i18n completion, auto-update, hardened defaults"
```

## Labels

```bash
for label in "good first issue" "help wanted" protocol security documentation desktop cli; do
  gh label create "$label" --repo aiLi0617/ApiVoy --force
done
```

## Seed issues (real work items)

```bash
gh issue create --repo aiLi0617/ApiVoy --title "[Desktop] Fix narrow-screen workbench layout compression" --label "desktop,bug" --milestone "v0.1 Public Alpha" --body "See docs/ISSUES.md ISS-003. Main workbench collapses to sidebar width on narrow viewports."

gh issue create --repo aiLi0617/ApiVoy --title "[Testing] Extend Playwright smoke to execute HTTP requests" --label "documentation,desktop" --milestone "v0.1 Public Alpha" --body "See docs/ISSUES.md ISS-006. Current smoke only checks layout, not send/receive."

gh issue create --repo aiLi0617/ApiVoy --title "[gRPC] Expand reflection compatibility tests" --label "protocol,help wanted" --milestone "v0.2 Protocol Stability" --body "Add integration tests against a local gRPC echo service; mark public matrix accordingly."

gh issue create --repo aiLi0617/ApiVoy --title "[Release] Add checksum verification docs" --label "documentation" --milestone "v0.1 Public Alpha" --body "Document SHA256SUMS.txt verification for Windows/macOS/Linux downloads."

gh issue create --repo aiLi0617/ApiVoy --title "[Security] Document local-agent threat model in user docs" --label "security,documentation" --milestone "v0.2 Protocol Stability" --body "Expand docs/security/local-agent.md with pairing flow diagrams."

gh issue create --repo aiLi0617/ApiVoy --title "[Plugin] Publish an example WASM transformer plugin" --label "protocol,good first issue" --milestone "v0.3 Plugin Ecosystem" --body "Ship a buildable example under examples/plugins/ with CI build step."

gh issue create --repo aiLi0617/ApiVoy --title "[i18n] Complete English and Chinese workbench strings" --label "documentation,help wanted" --milestone "v1.0 Stable" --body "Migrate remaining hardcoded Chinese strings in workbench panels to i18n resources."

gh issue create --repo aiLi0617/ApiVoy --title "[Desktop] Add automatic update verification" --label "desktop" --milestone "v1.0 Stable" --body "Design and implement signed update channel for Tauri desktop builds."

gh issue create --repo aiLi0617/ApiVoy --title "[Testing] Add protocol compatibility test matrix" --label "protocol,documentation" --milestone "v0.2 Protocol Stability" --body "Track broker/server versions with reproducible docker-compose fixtures."

gh issue create --repo aiLi0617/ApiVoy --title "[Docs] Add protocol-specific getting started tutorials" --label "documentation,good first issue" --milestone "v0.1 Public Alpha" --body "Expand docs/protocols/ with step-by-step walkthroughs linked from README."
```

## Release v0.1.0-alpha.1

After merging release workflow changes:

```bash
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1
```

The [Release workflow](../../.github/workflows/release.yml) will:

1. Run typecheck, tests, `cargo test`, and `cargo clippy`
2. Build Desktop installers for Windows, macOS, and Linux
3. Build and upload CLI/Agent archives
4. Generate and upload `SHA256SUMS.txt`
5. Create a **Draft pre-release** with notes from [CHANGELOG.md](../../CHANGELOG.md) or [.github/release-notes/alpha.md](../../.github/release-notes/alpha.md)

Download and verify all platform assets, then **manually publish** the release from GitHub when ready. Do not auto-publish draft releases from CI.

Release title:

`ApiVoy v0.1.0-alpha.1 — First Public Alpha`
