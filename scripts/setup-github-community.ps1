# GitHub community bootstrap (requires gh CLI + admin access)
$ErrorActionPreference = "Stop"
$Repo = "aiLi0617/ApiVoy"

Write-Host "Setting repository metadata..."
gh repo edit $Repo `
  --homepage "https://github.com/aiLi0617/ApiVoy" `
  --add-topic api-client --add-topic api-testing --add-topic developer-tools `
  --add-topic http-client --add-topic grpc --add-topic graphql --add-topic websocket `
  --add-topic mqtt --add-topic kafka --add-topic rust --add-topic tauri `
  --add-topic local-first --add-topic open-source

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

$labels = @("good first issue", "help wanted", "protocol", "security", "documentation", "desktop", "cli", "bug")
foreach ($label in $labels) {
  gh label create $label --repo $Repo --force | Out-Null
}

Write-Host "Done."
Write-Host "Enable Dependabot, secret scanning, push protection, and Private vulnerability reporting in GitHub Settings."
Write-Host "Mark legacy V1.0.0/V1.0.1 releases as pre-releases if they still exist."
Write-Host "See docs/maintainers/GITHUB_SETUP.md for discussion categories and seed issues."
