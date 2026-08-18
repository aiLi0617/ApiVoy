# Create ApiVoy GitHub issue labels (requires gh CLI + repo admin).
# Usage:
#   .\scripts\create-github-labels.ps1
#   .\scripts\create-github-labels.ps1 -Extended
#   .\scripts\create-github-labels.ps1 -Repo owner/repo

param(
  [string]$Repo = "aiLi0617/ApiVoy",
  [switch]$Extended
)

$ErrorActionPreference = "Stop"

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

function New-GhLabel {
  param(
    [string]$Name,
    [string]$Color,
    [string]$Description
  )
  Write-Host "  $Name"
  gh label create $Name `
    --repo $Repo `
    --color $Color `
    --description $Description `
    --force | Out-Null
}

$coreLabels = @(
  @{
    Name        = "good first issue"
    Color       = "0E8A16"
    Description = "Good entry point for new contributors; scope is small and well-defined."
  },
  @{
    Name        = "help wanted"
    Color       = "1D76DB"
    Description = "Maintainer welcome; extra hands or domain expertise needed."
  },
  @{
    Name        = "bug"
    Color       = "D73A4A"
    Description = "Something is broken or behaves incorrectly."
  },
  @{
    Name        = "documentation"
    Color       = "0075CA"
    Description = "README, docs/, examples, or in-app copy improvements."
  },
  @{
    Name        = "desktop"
    Color       = "D93F0B"
    Description = "Tauri desktop app, installers, CSP, or desktop-only UX."
  },
  @{
    Name        = "cli"
    Color       = "006B75"
    Description = "apivoy-cli commands, exit codes, CI automation."
  },
  @{
    Name        = "protocol"
    Color       = "5319E7"
    Description = "HTTP, GraphQL, gRPC, WebSocket, MQTT, Kafka, and related drivers."
  },
  @{
    Name        = "security"
    Color       = "B60205"
    Description = "Auth, secrets, Agent, plugins, imports, threat model (not public vuln reports)."
  }
)

$extendedLabels = @(
  @{
    Name        = "enhancement"
    Color       = "A2EEEF"
    Description = "New feature or measurable improvement to existing behavior."
  },
  @{
    Name        = "question"
    Color       = "D876E3"
    Description = "Usage question or design discussion tracked as an issue."
  },
  @{
    Name        = "dependencies"
    Color       = "0366D6"
    Description = "Dependency upgrades, audit findings, or lockfile changes."
  },
  @{
    Name        = "ci"
    Color       = "FBCA04"
    Description = "GitHub Actions, release workflow, or test infrastructure."
  },
  @{
    Name        = "web"
    Color       = "F9D0C4"
    Description = "Web workbench or Local Agent pairing from the browser."
  },
  @{
    Name        = "i18n"
    Color       = "C5DEF5"
    Description = "English/Chinese locale strings and translation gaps."
  },
  @{
    Name        = "plugin"
    Color       = "BFDADC"
    Description = "WASM plugins, QuickJS scripts, plugin permissions."
  },
  @{
    Name        = "duplicate"
    Color       = "CFD3D7"
    Description = "Duplicate of an existing issue."
  },
  @{
    Name        = "invalid"
    Color       = "FFFFFF"
    Description = "Not reproducible, out of scope, or not a project issue."
  },
  @{
    Name        = "wontfix"
    Color       = "FFFFFF"
    Description = "Valid but intentionally not planned for the current roadmap."
  }
)

Require-Gh

Write-Host "Creating core labels on $Repo ..."
foreach ($label in $coreLabels) {
  New-GhLabel @label
}

if ($Extended) {
  Write-Host "Creating extended labels ..."
  foreach ($label in $extendedLabels) {
    New-GhLabel @label
  }
}

Write-Host "Done. Labels: https://github.com/$Repo/labels"
