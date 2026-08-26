## Summary

What does this pull request change?

## Related issue

Closes #

## Change type

- [ ] Bug fix
- [ ] New feature
- [ ] Protocol compatibility
- [ ] Refactoring
- [ ] Documentation
- [ ] Security hardening

## Validation

- [ ] Type checking passes
- [ ] Unit tests pass
- [ ] Rust tests pass
- [ ] Clippy passes
- [ ] Documentation is updated
- [ ] UI screenshots are attached
- [ ] No credentials or private data are included
- [ ] Touched areas checked against [PR review checklist](../docs/maintainers/PR_REVIEW_CHECKLIST.md) (N/A if docs-only)

## Security impact

Describe changes involving secrets, authentication, TLS, scripts, plugins, proxying, or protocol parsing.

When touching Cargo.lock / UI parsers / Agent health / workflows, also confirm:

- [ ] `cargo audit -D warnings` if Rust lockfile changed
- [ ] No new CodeQL-prone patterns (DOMParser validation, chained HTML unescape, path `__proto__` writes, unbounded template regex) — see checklist §2
- [ ] Installer/smoke health asserts `service: "apivoy-agent"` if Agent contract changed — see checklist §3
