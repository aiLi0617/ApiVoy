# GitHub community bootstrap (requires gh CLI + admin access)
# Prefer the one-shot script:
#   .\scripts\create-github-community.ps1
#
# Labels only:
#   .\scripts\create-github-labels.ps1
#   .\scripts\create-github-labels.ps1 -Extended

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$ScriptDir\create-github-community.ps1" @args
