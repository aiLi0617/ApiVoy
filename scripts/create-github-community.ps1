# One-shot GitHub community setup for ApiVoy (requires gh CLI + repo admin).
# Creates: labels (8 core), milestones (4), seed issues (10).
#
# Usage:
#   .\scripts\create-github-community.ps1
#   .\scripts\create-github-community.ps1 -ExtendedLabels
#   .\scripts\create-github-community.ps1 -SkipIssues
#   .\scripts\create-github-community.ps1 -SkipMetadata

param(
  [string]$Repo = "aiLi0617/ApiVoy",
  [switch]$ExtendedLabels,
  [switch]$SkipIssues,
  [switch]$SkipMetadata
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Require-Gh {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Error @"
GitHub CLI (gh) is not installed.
Install: https://cli.github.com/
Then run: gh auth login
"@
  }
  gh auth status 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Error "gh is not authenticated. Run: gh auth login"
  }
}

Require-Gh

if (-not $SkipMetadata) {
  Write-Host "Setting repository metadata ..."
  gh repo edit $Repo `
    --homepage "https://github.com/aiLi0617/ApiVoy" `
    --add-topic api-client --add-topic api-testing --add-topic developer-tools `
    --add-topic http-client --add-topic grpc --add-topic graphql --add-topic websocket `
    --add-topic mqtt --add-topic kafka --add-topic rust --add-topic tauri `
    --add-topic local-first --add-topic open-source

  Write-Host "Enabling Discussions ..."
  gh api --method PUT "repos/$Repo" -f has_discussions=true | Out-Null
}

Write-Host "Creating labels ..."
$labelArgs = @("-Repo", $Repo)
if ($ExtendedLabels) { $labelArgs += "-Extended" }
& "$ScriptDir\create-github-labels.ps1" @labelArgs

$milestones = @(
  @{ title = "v0.1 Public Alpha"; description = "First public alpha release and installers" },
  @{ title = "v0.2 Protocol Stability"; description = "gRPC/MQ broker tests and compatibility matrix" },
  @{ title = "v0.3 Plugin Ecosystem"; description = "Example WASM plugins and publisher docs" },
  @{ title = "v1.0 Stable"; description = "i18n completion, auto-update, hardened defaults" }
)

Write-Host "Creating milestones ..."
foreach ($m in $milestones) {
  Write-Host "  $($m.title)"
  gh api "repos/$Repo/milestones" -f title=$($m.title) -f description=$($m.description) | Out-Null
}

if ($SkipIssues) {
  Write-Host "Skipped seed issues (-SkipIssues)."
  exit 0
}

$seedIssues = @(
  @{
    Title     = "[Desktop] Fix narrow-screen workbench layout compression"
    Labels    = "desktop,bug"
    Milestone = "v0.1 Public Alpha"
    Body      = "See docs/ISSUES.md ISS-003.`n`nMain workbench collapses to sidebar width on narrow viewports."
  },
  @{
    Title     = "[Testing] Extend Playwright smoke to execute HTTP requests"
    Labels    = "documentation,desktop"
    Milestone = "v0.1 Public Alpha"
    Body      = "See docs/ISSUES.md ISS-006.`n`nCurrent smoke only checks layout, not send/receive."
  },
  @{
    Title     = "[gRPC] Expand reflection compatibility tests"
    Labels    = "protocol,help wanted"
    Milestone = "v0.2 Protocol Stability"
    Body      = "Add integration tests against a local gRPC echo service; update the public protocol matrix accordingly."
  },
  @{
    Title     = "[Release] Add checksum verification docs"
    Labels    = "documentation"
    Milestone = "v0.1 Public Alpha"
    Body      = "Document SHA256SUMS.txt verification for Windows, macOS, and Linux downloads."
  },
  @{
    Title     = "[Security] Document local-agent threat model in user docs"
    Labels    = "security,documentation"
    Milestone = "v0.2 Protocol Stability"
    Body      = "Expand docs/security/local-agent.md with pairing flow diagrams."
  },
  @{
    Title     = "[Plugin] Publish an example WASM transformer plugin"
    Labels    = "protocol,good first issue"
    Milestone = "v0.3 Plugin Ecosystem"
    Body      = "Ship a buildable example under examples/plugins/ with a CI build step."
  },
  @{
    Title     = "[i18n] Complete English and Chinese workbench strings"
    Labels    = "documentation,help wanted"
    Milestone = "v1.0 Stable"
    Body      = "Migrate remaining hardcoded Chinese strings in workbench panels to i18n resources."
  },
  @{
    Title     = "[Desktop] Add automatic update verification"
    Labels    = "desktop"
    Milestone = "v1.0 Stable"
    Body      = "Design and implement a signed update channel for Tauri desktop builds."
  },
  @{
    Title     = "[Testing] Add protocol compatibility test matrix"
    Labels    = "protocol,documentation"
    Milestone = "v0.2 Protocol Stability"
    Body      = "Track broker/server versions with reproducible docker-compose fixtures."
  },
  @{
    Title     = "[Docs] Add protocol-specific getting started tutorials"
    Labels    = "documentation,good first issue"
    Milestone = "v0.1 Public Alpha"
    Body      = "Expand docs/protocols/ with step-by-step walkthroughs linked from README."
  }
)

Write-Host "Creating seed issues ..."
foreach ($issue in $seedIssues) {
  Write-Host "  $($issue.Title)"
  gh issue create `
    --repo $Repo `
    --title $issue.Title `
    --label $issue.Labels `
    --milestone $issue.Milestone `
    --body $issue.Body | Out-Null
}

Write-Host ""
Write-Host "Done."
Write-Host "  Labels:      https://github.com/$Repo/labels"
Write-Host "  Milestones:  https://github.com/$Repo/milestones"
Write-Host "  Issues:      https://github.com/$Repo/issues"
Write-Host ""
Write-Host "Manual steps still required:"
Write-Host "  - Advanced Security: Dependabot + Private vulnerability reporting"
Write-Host "  - Discussions: add Protocol compatibility category if missing"
Write-Host "  - Mark legacy V1.0.0/V1.0.1 releases as pre-releases"
