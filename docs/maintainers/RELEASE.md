# Release v0.1.0-alpha.1

## Publish (maintainer)

1. Merge OSS readiness changes to `main`.
2. Ensure all manifests report version `0.1.0-alpha.1`.
3. Create and push the tag:

```bash
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1
```

4. Wait for the [Release workflow](../../.github/workflows/release.yml) to finish.
5. Download every platform asset from the **Draft** release and verify checksums.
6. Manually publish the release when verification passes.

Release notes source: [CHANGELOG.md](../../CHANGELOG.md) or [.github/release-notes/alpha.md](../../.github/release-notes/alpha.md)

Release title: **ApiVoy v0.1.0-alpha.1 — First Public Alpha**

## Verify downloads

### Checksums

```bash
sha256sum -c SHA256SUMS.txt
```

This release provides SHA-256 checksums only (`SHA256SUMS.txt`), not cryptographic signatures.

### CLI smoke test

```bash
apivoy-cli --version
apivoy-cli http-get https://httpbin.org/get
apivoy-cli run examples/collections/httpbin-smoke.json
```

### Windows MSI

Install the `.msi` from the release page, launch ApiVoy, send `https://httpbin.org/get` from the HTTP workbench.

WiX/MSI only accepts numeric versions (`major.minor.patch.build`). The public app version remains `0.1.0-alpha.1`; Windows MSI ProductVersion is overridden to `0.1.0.1` in `apps/desktop/src-tauri/tauri.conf.json`.

## Local build note

Windows developer machines need OpenSSL build tooling (or vendored OpenSSL) for full workspace release builds. CI runners on GitHub Actions perform the official release builds.

## Re-tagging

If the tag was pushed before fixes landed, delete the remote tag and draft release, then push the tag again after merging fixes:

```bash
git push origin :refs/tags/v0.1.0-alpha.1
git tag -d v0.1.0-alpha.1
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1
```
