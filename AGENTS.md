# AGENTS.md

## Repository goals

ApiVoy is a local-first multi-protocol API debugging client.

## Required validation

For TypeScript changes:

- `pnpm typecheck`
- `pnpm test`

For Rust changes:

- `cargo test --workspace --locked`
- `cargo clippy --workspace --all-targets --locked -- -D warnings`

For UI changes:

- Attach screenshots
- Run browser smoke tests (`pnpm test:e2e`)

## Security rules

- Never commit credentials or certificates.
- Never log unmasked authorization headers.
- Treat import files and plugin packages as untrusted input.
- Do not weaken Local Agent authentication.
- Do not enable remote binding by default.
- Changes to secrets, proxying, scripts, and plugins require security review.
- Before merging security-, dependency-, workflow-, or parser-related changes, apply
  [docs/maintainers/PR_REVIEW_CHECKLIST.md](docs/maintainers/PR_REVIEW_CHECKLIST.md)
  so CI/CodeQL/Installer failures are caught in review rather than only on GitHub Actions.

## Scope rules

- Keep pull requests focused.
- Update documentation with behavior changes.
- Add regression tests for bug fixes.
- Preserve backward compatibility for workspace files where possible.

See [docs/maintainers/CODEX_WORKFLOWS.md](docs/maintainers/CODEX_WORKFLOWS.md) for planned Codex maintainer workflows.
See [docs/maintainers/PR_REVIEW_CHECKLIST.md](docs/maintainers/PR_REVIEW_CHECKLIST.md) for front-loaded review checks.
