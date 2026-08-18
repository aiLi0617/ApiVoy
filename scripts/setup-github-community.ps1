# GitHub community bootstrap (requires gh CLI + admin access)
$ErrorActionPreference = "Stop"
$Repo = "aiLi0617/ApiVoy"

Write-Host "Enabling Discussions..."
gh api --method PUT "repos/$Repo" -f has_discussions=true

$milestones = @(
  @{ title = "v0.1 Public Alpha"; description = "First public alpha release and installers" },
  @{ title = "v0.2 Protocol Stability"; description = "gRPC/MQ broker tests and compatibility matrix" },
  @{ title = "v0.3 Plugin Ecosystem"; description = "Example WASM plugins and publisher docs" },
  @{ title = "v1.0 Stable"; description = "i18n completion, auto-update, hardened defaults" }
)
foreach ($m in $milestones) {
  Write-Host "Creating milestone $($m.title)..."
  gh api "repos/$Repo/milestones" -f title=$($m.title) -f description=$($m.description) | Out-Null
}

$labels = @("good first issue", "help wanted", "protocol", "security", "documentation", "desktop", "cli")
foreach ($label in $labels) {
  gh label create $label --repo $Repo --force | Out-Null
}

Write-Host "Done. Enable Private vulnerability reporting in GitHub Settings manually if not already enabled."
Write-Host "See docs/maintainers/GITHUB_SETUP.md for discussion categories and seed issues."
