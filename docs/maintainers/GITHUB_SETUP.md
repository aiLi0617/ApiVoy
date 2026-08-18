# GitHub repository setup

Run these commands after pushing the OSS readiness changes to `main`.
Requires [GitHub CLI](https://cli.github.com/) authenticated as a repository admin.

## Private vulnerability reporting

In the GitHub UI:

**Settings → Security → Private vulnerability reporting → Enable**

Or via API (when available for your token):

```bash
gh api --method PUT repos/aiLi0617/ApiVoy/vulnerability-alerts -f enabled=true
```

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

gh issue create --repo aiLi0617/ApiVoy --title "[Release] Add signed checksum verification docs" --label "documentation" --milestone "v0.1 Public Alpha" --body "Document SHA256SUMS.txt verification for Windows/macOS/Linux downloads."

gh issue create --repo aiLi0617/ApiVoy --title "[Security] Document local-agent threat model in user docs" --label "security,documentation" --milestone "v0.2 Protocol Stability" --body "Expand docs/security/local-agent.md with pairing flow diagrams."

gh issue create --repo aiLi0617/ApiVoy --title "[Plugin] Publish an example WASM transformer plugin" --label "protocol,good first issue" --milestone "v0.3 Plugin Ecosystem" --body "Ship a buildable example under examples/plugins/ with CI build step."

gh issue create --repo aiLi0617/ApiVoy --title "[i18n] Complete English and Chinese workbench strings" --label "documentation,help wanted" --milestone "v1.0 Stable" --body "Migrate remaining hardcoded Chinese strings in workbench panels to i18n resources."

gh issue create --repo aiLi0617/ApiVoy --title "[Desktop] Add automatic update verification" --label "desktop" --milestone "v1.0 Stable" --body "Design and implement signed update channel for Tauri desktop builds."

gh issue create --repo aiLi0617/ApiVoy --title "[Testing] Add protocol compatibility test matrix" --label "protocol,documentation" --milestone "v0.2 Protocol Stability" --body "Track broker/server versions with reproducible docker-compose fixtures."

gh issue create --repo aiLi0617/ApiVoy --title "[Docs] Add protocol-specific getting started tutorials" --label "documentation,good first issue" --milestone "v0.1 Public Alpha" --body "Expand docs/protocols/ with step-by-step walkthroughs linked from README."
```

Fix typo in gRPC issue: aiLiLi0617 -> aiLi0617

## Release v0.1.0-alpha.1

After merging release workflow changes:

```bash
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1
```

The [Release workflow](../.github/workflows/release.yml) will:

1. Build Desktop installers for Windows, macOS, and Linux
2. Build and upload CLI/Agent archives
3. Generate and upload `SHA256SUMS.txt`
4. Publish the draft release with notes from [.github/release-notes/alpha.md](../.github/release-notes/alpha.md)

Edit the published release title to:

`ApiVoy v0.1.0-alpha.1 — First Public Alpha`
