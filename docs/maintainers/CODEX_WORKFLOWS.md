# Codex maintainer workflows

Codex credits for this project are intended **only** for maintaining this public repository.

## Planned uses

Codex will be used for:

1. Pull-request summaries
2. Risk-area identification (secrets, Agent auth, plugins, parsers)
3. Missing-test suggestions
4. Protocol compatibility review
5. Documentation synchronization
6. Issue classification
7. Release-note drafting
8. Security-sensitive change review assistance

When reviewing or summarizing PRs, apply the front-loaded checks in
[PR_REVIEW_CHECKLIST.md](./PR_REVIEW_CHECKLIST.md) for any touched surface
(dependencies, CodeQL-prone UI/import code, Agent health contract, workflows).

All Codex output **must be reviewed by a maintainer** before merging or publishing.

## Explicitly excluded

Credits will **not** be used for:

- Closed-source or commercial services outside this repository
- Other private repositories
- Providing free AI inference to end users of ApiVoy
- Unauthorized third-party code security scanning
- Unrelated personal projects

## Automation status

Automated Codex workflows are **planned**, not yet deployed in CI. This document describes intended scope only.

See also [AGENTS.md](../../AGENTS.md) and the Open-source scope section in [README.md](../../README.md).
